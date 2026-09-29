import assert from "node:assert/strict";
import { after, test } from "node:test";
import { normalizarTelefoneBrasileiro } from "../src/lib/telefone.ts";
import { prisma } from "../src/lib/prisma.ts";
import { POST } from "../src/app/api/clientes/identificar/route.ts";

after(async () => { await prisma.$disconnect(); });

const variants = ["(92) 99999-9999", "92 99999-9999", "92999999999", "+55 92 99999-9999"];
for (const input of variants) {
  test(`normaliza ${input}`, () => {
    assert.equal(normalizarTelefoneBrasileiro(input), "+5592999999999");
  });
}
test("rejeita valores inválidos, DDD inválido, exterior, texto e ramal", () => {
  for (const value of ["abc", "123", "", null, undefined, 92999999999, {}, [],
    "   ", "(00) 99999-9999", "+1 213 373 4253", "Ligue (92) 99999-9999",
    "(92) 99999-9999 ramal 1", "+55", "9".repeat(65)]) {
    assert.equal(normalizarTelefoneBrasileiro(value), null);
  }
});
test("permite telefone fixo brasileiro válido", () => {
  assert.equal(normalizarTelefoneBrasileiro("(11) 2345-6789"), "+551123456789");
});

function mockQuery(t, implementation) {
  const original = prisma.cliente.findUnique;
  const query = t.mock.fn(implementation);
  prisma.cliente.findUnique = query;
  t.after(() => { prisma.cliente.findUnique = original; });
  return query;
}

function request(body) {
  return new Request("http://localhost/api/clientes/identificar", {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
}
test("corpos inválidos são rejeitados antes de consultar o banco", async (t) => {
  const query = mockQuery(t, async () => { throw new Error("Não deveria consultar"); });
  for (const body of [undefined, "", "{", "null", "[]", "42", "{}", '{"telefone":null}', '{"telefone":123}']) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const telefone of ["", " ", "abc", "123", "+1 213 373 4253"]) {
    assert.equal((await POST(request(JSON.stringify({ telefone })))).status, 422);
  }
  assert.equal(query.mock.callCount(), 0);
});
test("normaliza antes da consulta e não distingue cliente existente de ausente", async (t) => {
  const query = mockQuery(t, async () => null);
  for (const telefone of variants) {
    const response = await POST(request(JSON.stringify({ telefone })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { telefone: "+5592999999999", podeProsseguirParaVerificacao: true });
  }
  assert.deepEqual(query.mock.calls[0].arguments[0], { where: { telefone: "+5592999999999" }, select: { id: true } });
  query.mock.mockImplementation(async () => ({ id: "identificador-apenas-no-teste" }));
  const response = await POST(request(JSON.stringify({ telefone: variants[0] })));
  assert.deepEqual(await response.json(), { telefone: "+5592999999999", podeProsseguirParaVerificacao: true });
  assert.equal(response.headers.get("set-cookie"), null);
});
test("falha do banco recebe resposta genérica sem detalhes internos", async (t) => {
  mockQuery(t, async () => { throw new Error("detalhe-interno-que-nao-pode-vazar"); });
  const response = await POST(request(JSON.stringify({ telefone: variants[0] })));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    erro: "SERVICO_INDISPONIVEL",
    mensagem: "Não foi possível continuar agora. Tente novamente mais tarde.",
  });
});
