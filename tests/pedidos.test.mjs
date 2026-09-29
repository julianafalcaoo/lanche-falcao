import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { prisma } from "../src/lib/prisma.ts";
import { products } from "../src/data/menu.ts";
import { newToken, sessionCookieName, tokenHash } from "../src/server/auth/session.ts";
import { POST, GET as list } from "../src/app/api/pedidos/route.ts";
import { GET as detail } from "../src/app/api/pedidos/[id]/route.ts";
import { parsePedido } from "../src/server/pedidos/validation.ts";

const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!/^lf_auth_test_[a-f0-9]{24}$/.test(database) || database !== process.env.AUTH_TEST_DATABASE) throw new Error("Use o runner de banco descartável.");
let a, b;
const pickup = { tipo: "RETIRADA", itens: [{ productId: "coxinha-frango", quantity: 2 }] };
const address = { postalCode: "69000-000", street: " Rua de teste ", number: "10", neighborhood: "Centro", city: "Manaus", state: "am", complement: "", reference: "Próximo à praça" };
const delivery = { ...pickup, tipo: "ENTREGA", endereco: address };
async function fixture(telefone) {
  const cliente = await prisma.cliente.create({ data: { nome: "Cliente temporário", telefone, telefoneVerificado: true } });
  const token = newToken();
  await prisma.sessao.create({ data: { clienteId: cliente.id, tokenHash: tokenHash(token), expiraEm: new Date(Date.now() + 3600000) } });
  return { id: cliente.id, cookie: `${sessionCookieName()}=${token}` };
}
beforeEach(async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Rede externa proibida nos testes de pedidos."); });
  await prisma.itemPedido.deleteMany();
  await prisma.pedido.deleteMany();
  await prisma.sessao.deleteMany();
  await prisma.cliente.deleteMany();
  a = await fixture("+5592999999999"); b = await fixture("+5592999999998");
  t.after(() => { assert.equal(fetch.mock.callCount(), 0, "Pedidos não devem chamar APIs externas."); });
});
after(async () => { await prisma.$disconnect(); });
function post(body = pickup, key = randomUUID(), cookie = a.cookie, headers = {}) {
  return POST(new Request("http://localhost/api/pedidos", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "Idempotency-Key": key, cookie, ...headers }, body: JSON.stringify(body),
  }));
}
function get(id, cookie = a.cookie) {
  return detail(new Request(`http://localhost/api/pedidos/${id}`, { headers: { cookie } }), { params: Promise.resolve({ id }) });
}
function listing(query = "", cookie = a.cookie) {
  return list(new Request(`http://localhost/api/pedidos${query}`, { headers: { cookie } }));
}
async function created(body = pickup, key = randomUUID(), cookie = a.cookie) {
  const response = await post(body, key, cookie);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return (await response.json()).pedido;
}
async function empty() { assert.equal(await prisma.pedido.count(), 0); assert.equal(await prisma.itemPedido.count(), 0); }

test("retirada autenticada cria snapshots reais, status inicial e centavos inteiros", async () => {
  const pedido = await created();
  assert.equal(pedido.tipo, "RETIRADA");
  assert.equal(pedido.status, "PEDIDO_RECEBIDO");
  assert.equal(pedido.subtotalCentavos, 800);
  assert.equal(pedido.totalCentavos, 800);
  assert.deepEqual(pedido.itens, [{ produtoId: "coxinha-frango", nomeProduto: "Coxinha de frango", precoUnitarioCentavos: 400, quantidade: 2, subtotalCentavos: 800 }]);
  assert.equal("endereco" in pedido, false);
  for (const key of ["clienteId", "chaveIdempotencia", "requisicaoHash", "token", "pinId"]) assert.equal(key in pedido, false);
  const row = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
  assert.equal(row.clienteId, a.id);
  assert.equal(row.entregaCep, null);
  assert.ok(pedido.criadoEm && pedido.atualizadoEm);
});

test("múltiplos produtos somam subtotais e total sem taxa ou desconto", async () => {
  const pedido = await created({ tipo: "RETIRADA", itens: [{ productId: "coxinha-frango", quantity: 2 }, { productId: "pepsi-lata", quantity: 3 }] });
  assert.equal(pedido.subtotalCentavos, 2300);
  assert.equal(pedido.totalCentavos, 2300);
  assert.deepEqual(pedido.itens.map((item) => item.subtotalCentavos), [800, 1500]);
});

test("entrega normaliza CEP/UF e salva endereço no pedido, sem alterar cliente", async () => {
  const before = await prisma.cliente.findUnique({ where: { id: a.id } });
  const pedido = await created(delivery);
  assert.deepEqual(pedido.endereco, { ...address, postalCode: "69000000", street: "Rua de teste", state: "AM" });
  assert.deepEqual(await prisma.cliente.findUnique({ where: { id: a.id } }), before);
  const response = await get(pedido.id);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).pedido, pedido);
});

test("todas as rotas recusam sessão ausente, inválida, expirada ou cliente não verificado", async () => {
  for (const cookie of ["", "lf_session=invalido"]) {
    assert.equal((await post(pickup, randomUUID(), cookie)).status, 401);
    assert.equal((await listing("", cookie)).status, 401);
    assert.equal((await get(randomUUID(), cookie)).status, 401);
  }
  await prisma.sessao.updateMany({ where: { clienteId: a.id }, data: { expiraEm: new Date(0) } });
  assert.equal((await post()).status, 401);
  assert.equal((await listing()).status, 401);
  assert.equal((await get(randomUUID())).status, 401);
  await prisma.cliente.update({ where: { id: b.id }, data: { telefoneVerificado: false } });
  assert.equal((await post(pickup, randomUUID(), b.cookie)).status, 401);
  await empty();
});

test("POST recusa origem externa, conteúdo inválido e chave ausente/malformada", async () => {
  assert.equal((await post(pickup, randomUUID(), a.cookie, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(pickup, randomUUID(), a.cookie, { "content-type": "text/plain" })).status, 415);
  for (const key of ["", "not-uuid", "x".repeat(200)]) assert.equal((await post(pickup, key)).status, 400);
  const request = new Request("http://localhost/api/pedidos", { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost", "content-type": "application/json", "Idempotency-Key": randomUUID() }, body: "{" });
  assert.equal((await POST(request)).status, 400);
  await empty();
});

for (const quantity of [0, -1, 1.5, 101, Number.MAX_SAFE_INTEGER, "2", null]) {
  test(`rejeita quantidade ${String(quantity)}`, async () => {
    assert.equal((await post({ ...pickup, itens: [{ productId: "coxinha-frango", quantity }] })).status, 422);
    await empty();
  });
}
test("NaN é rejeitado na validação e 100 é o máximo aceito", async () => {
  assert.throws(() => parsePedido({ ...pickup, itens: [{ productId: "coxinha-frango", quantity: NaN }] }), /quantidade/);
  const pedido = await created({ ...pickup, itens: [{ productId: "coxinha-frango", quantity: 100 }] });
  assert.equal(pedido.totalCentavos, 40000);
});

for (const [name, body] of [
  ["produto inexistente", { ...pickup, itens: [{ productId: "nao-existe", quantity: 1 }] }],
  ["carrinho vazio", { ...pickup, itens: [] }],
  ["produto repetido", { ...pickup, itens: [...pickup.itens, ...pickup.itens] }],
  ["mais de 100 linhas", { ...pickup, itens: Array(101).fill(pickup.itens[0]) }],
  ["tipo inválido", { ...pickup, tipo: "pickup" }],
  ["entrega sem endereço", { ...pickup, tipo: "ENTREGA" }],
  ["retirada com endereço", { ...pickup, endereco: address }],
]) {
  test(`rejeita ${name}`, async () => { assert.equal((await post(body)).status, 422); await empty(); });
}

for (const [field, value] of [["street", " "], ["number", ""], ["neighborhood", ""], ["city", ""], ["postalCode", "123"], ["state", "XX"], ["street", "x".repeat(201)], ["reference", 123]]) {
  test(`valida endereço: ${field}`, async () => {
    assert.equal((await post({ ...delivery, endereco: { ...address, [field]: value } })).status, 422);
    await empty();
  });
}

for (const [field, value] of [["clienteId", "outro"], ["status", "ENTREGUE"], ["totalCentavos", 1], ["subtotalCentavos", 1]]) {
  test(`rejeita manipulação de ${field}`, async () => {
    assert.equal((await post({ ...pickup, [field]: value })).status, 422);
    await empty();
  });
}
test("rejeita preço e nome fornecidos pelo navegador", async () => {
  for (const extra of [{ priceInCents: 1 }, { precoUnitarioCentavos: 1 }, { nomeProduto: "Falso" }, { subtotalCentavos: 1 }]) {
    assert.equal((await post({ ...pickup, itens: [{ ...pickup.itens[0], ...extra }] })).status, 422);
  }
  await empty();
});

test("snapshot e retry permanecem iguais após alteração do catálogo", async (t) => {
  const key = randomUUID();
  const pedido = await created(pickup, key);
  const product = products.find((item) => item.id === "coxinha-frango");
  const original = { ...product };
  t.after(() => Object.assign(product, original));
  product.name = "Nome atualizado"; product.priceInCents = 500;
  assert.deepEqual((await (await get(pedido.id)).json()).pedido, pedido);
  assert.deepEqual((await (await post(pickup, key)).json()).pedido, pedido);
  const next = await created();
  assert.equal(next.totalCentavos, 1000);
  assert.equal(next.itens[0].nomeProduto, "Nome atualizado");
  product.id = "temporariamente-removido";
  assert.deepEqual((await (await post(pickup, key)).json()).pedido, pedido);
});

test("falha de item reverte pedido inteiro e permite repetir a chave após corrigir a falha", async () => {
  const key = randomUUID();
  const body = { ...pickup, itens: [...pickup.itens, { productId: "pepsi-lata", quantity: 1 }] };
  await prisma.$executeRawUnsafe(`ALTER TABLE "ItemPedido" ADD CONSTRAINT "test_reject_item" CHECK ("produtoId" <> 'pepsi-lata')`);
  try {
    const response = await post(body, key);
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ["erro", "mensagem"]);
    assert.equal(JSON.stringify(data).includes("test_reject_item"), false);
    await empty();
  } finally { await prisma.$executeRawUnsafe('ALTER TABLE "ItemPedido" DROP CONSTRAINT "test_reject_item"'); }
  await created(body, key);
  assert.equal(await prisma.pedido.count(), 1);
  assert.equal(await prisma.itemPedido.count(), 2);
});

test("idempotência sequencial e concorrente retorna um só pedido", async () => {
  const key = randomUUID();
  const responses = await Promise.all([post(pickup, key), post(pickup, key), post(pickup, key)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 200, 201]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(bodies[1], bodies[2]);
  const replay = await post(pickup, key);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), bodies[0]);
  assert.equal(await prisma.pedido.count(), 1);
  assert.equal(await prisma.itemPedido.count(), 1);
});

test("mesma chave com outro conteúdo conflita; chave tem escopo por cliente", async () => {
  const key = randomUUID();
  await created(pickup, key);
  assert.equal((await post({ ...pickup, itens: [{ productId: "coxinha-frango", quantity: 3 }] }, key)).status, 409);
  assert.equal((await post(delivery, key)).status, 409);
  await created(pickup, key, b.cookie);
  assert.equal(await prisma.pedido.count(), 2);
});

test("corrida de conteúdos distintos com mesma chave cria somente o vencedor", async () => {
  const key = randomUUID();
  const responses = await Promise.all([post(pickup, key), post(delivery, key)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await prisma.pedido.count(), 1);
});

test("hash normaliza ordem de itens, espaços, CEP e UF", async () => {
  const key = randomUUID();
  const body = { ...delivery, itens: [...pickup.itens, { productId: "pepsi-lata", quantity: 1 }] };
  const pedido = await created(body, key);
  const response = await post({ ...body, itens: [...body.itens].reverse(), endereco: { ...address, postalCode: "69000000", street: "Rua de teste", state: "AM" } }, key);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).pedido, pedido);
});

test("ownership: próprio pedido acessível; outro cliente e UUID inexistente retornam o mesmo 404", async () => {
  const pedido = await created();
  assert.equal((await get(pedido.id)).status, 200);
  const foreign = await get(pedido.id, b.cookie);
  const missing = await get(randomUUID(), b.cookie);
  assert.equal(foreign.status, 404); assert.equal(missing.status, 404);
  assert.deepEqual(await foreign.json(), await missing.json());
  assert.equal((await get("invalid")).status, 404);
});

test("listagem paginada somente do cliente, mais recentes primeiro, sem vazamento interno", async () => {
  const own = [];
  for (let i = 0; i < 4; i++) own.push(await created());
  const foreign = await created(pickup, randomUUID(), b.cookie);
  const first = await listing("?limite=2");
  assert.equal(first.headers.get("cache-control"), "no-store");
  const page1 = await first.json();
  const page2 = await (await listing(`?limite=2&cursor=${page1.proximoCursor}`)).json();
  assert.equal(page1.pedidos.length, 2); assert.equal(page2.pedidos.length, 2);
  assert.equal(page2.proximoCursor, null);
  const all = [...page1.pedidos, ...page2.pedidos];
  assert.equal(new Set(all.map((item) => item.id)).size, 4);
  assert.deepEqual(new Set(all.map((item) => item.id)), new Set(own.map((item) => item.id)));
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].criadoEm >= all[i].criadoEm);
  assert.equal(JSON.stringify(all).includes(a.id), false);
  assert.equal(JSON.stringify(all).includes("requisicaoHash"), false);
  assert.equal((await listing(`?cursor=${foreign.id}`)).status, 400);
  assert.equal((await (await listing("", b.cookie)).json()).pedidos.length, 1);
});

test("cursor desempata datas iguais e limites inválidos são recusados", async () => {
  for (let i = 0; i < 3; i++) await created();
  await prisma.pedido.updateMany({ data: { criadoEm: new Date("2026-01-01T00:00:00Z") } });
  const ids = [];
  let cursor = null;
  do {
    const data = await (await listing(`?limite=1${cursor ? `&cursor=${cursor}` : ""}`)).json();
    ids.push(...data.pedidos.map((item) => item.id)); cursor = data.proximoCursor;
  } while (cursor);
  assert.equal(new Set(ids).size, 3);
  for (const query of ["?limite=0", "?limite=51", "?limite=1.5", "?limite=abc", "?cursor=bad", "?limite=2&limite=3"]) assert.equal((await listing(query)).status, 400);
});

test("constraints de dinheiro, quantidade, endereço e status/tipo protegem o banco", async () => {
  const pedido = await created();
  await assert.rejects(prisma.pedido.update({ where: { id: pedido.id }, data: { totalCentavos: 1 } }));
  await assert.rejects(prisma.pedido.update({ where: { id: pedido.id }, data: { tipo: "ENTREGA" } }));
  await assert.rejects(prisma.pedido.update({ where: { id: pedido.id }, data: { status: "ENTREGUE" } }));
  const item = await prisma.itemPedido.findFirstOrThrow();
  await assert.rejects(prisma.itemPedido.update({ where: { id: item.id }, data: { quantidade: 0 } }));
  await assert.rejects(prisma.itemPedido.update({ where: { id: item.id }, data: { subtotalCentavos: 1 } }));
  await assert.rejects(prisma.cliente.delete({ where: { id: a.id } }));
});
