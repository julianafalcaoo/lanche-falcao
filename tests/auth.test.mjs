import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, after, test } from "node:test";
import { prisma } from "../src/lib/prisma.ts";
import { POST as solicitar } from "../src/app/api/auth/otp/solicitar/route.ts";
import { POST as verificar } from "../src/app/api/auth/otp/verificar/route.ts";
import { GET as me } from "../src/app/api/auth/me/route.ts";
import { POST as logout } from "../src/app/api/auth/logout/route.ts";
import { tokenHash, sessionCookie, SESSION_SECONDS } from "../src/server/auth/session.ts";

const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!/^lf_auth_test_[a-f0-9]{24}$/.test(database) || database !== process.env.AUTH_TEST_DATABASE) {
  throw new Error("Testes exigem banco descartável criado por scripts/test-auth.mjs.");
}
const telefone = "+5592999999999";
Object.assign(process.env, {
  INFOBIP_API_BASE_URL: "https://unit-test.api.infobip.com", INFOBIP_API_KEY: "fake-test-key",
  INFOBIP_2FA_APPLICATION_ID: "test-app", INFOBIP_2FA_MESSAGE_ID: "test-message",
});
let sentPin;
beforeEach(async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/verify")) return Response.json({ pinId: url.split("/").at(-2), verified: true });
    sentPin = randomBytes(16).toString("hex");
    return Response.json({ pinId: sentPin, smsStatus: "MESSAGE_SENT" });
  });
  await prisma.sessao.deleteMany();
  await prisma.desafioOtp.deleteMany();
  await prisma.cliente.deleteMany();
});
after(async () => { await prisma.$disconnect(); });
function request(body, cookie, overrides = {}) {
  return new Request("http://localhost/api/auth/test", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...(cookie ? { cookie } : {}), ...overrides },
    body: JSON.stringify(body),
  });
}
const getRequest = (cookie) => new Request("http://localhost/api/auth/me", { headers: cookie ? { cookie } : {} });
async function challenge(nome = "  Maria  ") {
  const response = await solicitar(request({ nome, telefone: "(92) 99999-9999" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["desafioId", "enviado"]);
  return body.desafioId;
}
async function login(id, cookie) {
  const response = await verificar(request({ desafioId: id, codigo: "0123" }, cookie));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verificado: true, autenticado: true });
  return response.headers.get("set-cookie");
}
async function noIdentity() {
  assert.equal(await prisma.cliente.count(), 0);
  assert.equal(await prisma.sessao.count(), 0);
}

test("valida nome, telefone, JSON, origem e conteúdo antes de enviar SMS", async () => {
  for (const nome of [undefined, null, "", "   ", 42, "a".repeat(101), "Maria\nSilva"]) {
    assert.equal((await solicitar(request({ nome, telefone }))).status, 422);
  }
  for (const value of ["123", "", null, "+12025550123"]) {
    assert.equal((await solicitar(request({ nome: "Maria", telefone: value }))).status, 422);
  }
  assert.equal((await solicitar(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" } }))).status, 400);
  for (const handler of [solicitar, verificar, logout]) {
    assert.equal((await handler(request({}, null, { origin: "https://evil.example" }))).status, 403);
    assert.equal((await handler(request({}, null, { origin: "null" }))).status, 403);
    assert.equal((await handler(request({}, null, { "sec-fetch-site": "cross-site" }))).status, 403);
    assert.equal((await handler(request({}, null, { "content-type": "text/plain" }))).status, 415);
  }
  assert.equal(fetch.mock.callCount(), 0);
  await noIdentity();
});

test("desafio persiste vínculo e validade sem revelar pinId nem criar cliente", async () => {
  const id = await challenge();
  const row = await prisma.desafioOtp.findUniqueOrThrow({ where: { id } });
  assert.equal(row.nome, "Maria");
  assert.equal(row.telefone, telefone);
  assert.equal(row.pinId, sentPin);
  assert.equal(row.estado, "PENDENTE");
  assert.ok(row.expiraEm - row.criadoEm <= 300000);
  assert.ok(row.expiraEm > new Date());
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal("codigo" in row, false);
  await noIdentity();
});

test("desafio inexistente, expirado, pinId arbitrário e código inválido não consultam Infobip", async () => {
  const id = await challenge();
  await prisma.desafioOtp.update({ where: { id }, data: { expiraEm: new Date(0) } });
  assert.equal((await verificar(request({ desafioId: id, codigo: "0123" }))).status, 410);
  assert.equal((await verificar(request({ desafioId: "a".repeat(64), codigo: "0123" }))).status, 404);
  assert.equal((await verificar(request({ pinId: sentPin, codigo: "0123" }))).status, 400);
  for (const codigo of ["123", "12345", "abcd", 1234]) {
    assert.equal((await verificar(request({ desafioId: id, codigo }))).status, 400);
  }
  assert.equal(fetch.mock.callCount(), 1);
  await noIdentity();
});

for (const [pinError, status, estado] of [["WRONG_PIN", 422, "PENDENTE"], ["TTL_EXPIRED", 410, "INVALIDADO"], ["NO_MORE_PIN_ATTEMPTS", 429, "INVALIDADO"]]) {
  test(`OTP ${pinError} não cria cliente/sessão`, async () => {
    const id = await challenge();
    fetch.mock.mockImplementation(async () => Response.json({ pinId: sentPin, verified: false, pinError }));
    const response = await verificar(request({ desafioId: id, codigo: "0123" }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await prisma.desafioOtp.findUniqueOrThrow({ where: { id } })).estado, estado);
    await noIdentity();
  });
}

test("OTP correto cria cliente verificado, sessão persistente com hash e me mínimo", async () => {
  const id = await challenge();
  const cookie = await login(id);
  for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${SESSION_SECONDS}`, "Expires="]) assert.ok(cookie.includes(flag));
  const token = cookie.split(";")[0].split("=")[1];
  const row = await prisma.sessao.findFirstOrThrow();
  assert.equal(row.tokenHash, tokenHash(token));
  assert.notEqual(row.tokenHash, token);
  assert.equal(await prisma.cliente.count(), 1);
  assert.equal((await prisma.cliente.findFirstOrThrow()).telefoneVerificado, true);
  assert.equal((await prisma.desafioOtp.findUniqueOrThrow({ where: { id } })).estado, "CONSUMIDO");
  for (let i = 0; i < 2; i++) {
    const response = await me(getRequest(cookie.split(";")[0]));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { autenticado: true, cliente: { nome: "Maria", telefone } });
  }
  assert.equal((await verificar(request({ desafioId: id, codigo: "0123" }))).status, 409);
  assert.equal(await prisma.sessao.count(), 1);
  assert.equal(fetch.mock.callCount(), 2);
});

test("cliente existente preserva nome, marca telefone e UNIQUE impede duplicado", async () => {
  await prisma.cliente.create({ data: { nome: "Nome original", telefone } });
  const id = await challenge("Nome diferente");
  await login(id);
  const cliente = await prisma.cliente.findFirstOrThrow();
  assert.equal(cliente.nome, "Nome original");
  assert.equal(cliente.telefoneVerificado, true);
  assert.equal(await prisma.cliente.count(), 1);
  await assert.rejects(prisma.cliente.create({ data: { nome: "Duplicado", telefone } }), (error) => error.code === "P2002");
});

test("submissões simultâneas do mesmo desafio fazem uma verificação e uma sessão", async () => {
  const id = await challenge();
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  fetch.mock.mockImplementation(async () => { started(); await gate; return Response.json({ pinId: sentPin, verified: true }); });
  const first = verificar(request({ desafioId: id, codigo: "0123" }));
  await entered;
  try { assert.equal((await verificar(request({ desafioId: id, codigo: "0123" }))).status, 409); }
  finally { release(); }
  assert.equal((await first).status, 200);
  assert.equal(await prisma.cliente.count(), 1);
  assert.equal(await prisma.sessao.count(), 1);
  assert.equal(fetch.mock.callCount(), 2);
});

test("dois desafios concorrentes do mesmo telefone não duplicam cliente", async () => {
  const a = await challenge("Primeiro");
  const b = await challenge("Segundo");
  const results = await Promise.all([verificar(request({ desafioId: a, codigo: "0123" })), verificar(request({ desafioId: b, codigo: "0123" }))]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(await prisma.cliente.count(), 1);
  assert.equal(await prisma.sessao.count(), 2);
});

test("sessão inválida/expirada é recusada; logout revoga e limpa cookie sem alterar cliente", async () => {
  const cookie = (await login(await challenge())).split(";")[0];
  assert.equal((await me(getRequest())).status, 401);
  assert.equal((await me(getRequest("lf_session=invalido"))).status, 401);
  await prisma.sessao.updateMany({ data: { expiraEm: new Date(0) } });
  assert.equal((await me(getRequest(cookie))).status, 401);
  const second = (await login(await challenge())).split(";")[0];
  const before = await prisma.cliente.findFirstOrThrow();
  const response = await logout(request({}, second));
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
  assert.equal((await me(getRequest(second))).status, 401);
  assert.deepEqual(await prisma.cliente.findFirstOrThrow(), before);
  assert.equal((await logout(request({}, second))).status, 200);
});

test("nova autenticação rotaciona sessão anterior e cookie de produção é Secure", async (t) => {
  const previous = (await login(await challenge())).split(";")[0];
  const next = (await login(await challenge(), previous)).split(";")[0];
  assert.notEqual(next, previous);
  assert.equal(await prisma.sessao.count(), 1);
  assert.equal((await me(getRequest(previous))).status, 401);
  const oldEnv = process.env.NODE_ENV;
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  process.env.NODE_ENV = "production";
  const cookie = sessionCookie("test", new Date());
  assert.ok(cookie.startsWith("__Host-lf_session="));
  assert.ok(cookie.includes("; Secure"));
  assert.equal(cookie.includes("Domain="), false);
});

test("falha ambígua do provedor invalida desafio sem criar identidade ou repetir verificação", async () => {
  const id = await challenge();
  fetch.mock.mockImplementation(async () => { throw new Error("simulated timeout"); });
  assert.equal((await verificar(request({ desafioId: id, codigo: "0123" }))).status, 503);
  assert.equal((await verificar(request({ desafioId: id, codigo: "0123" }))).status, 409);
  assert.equal(fetch.mock.callCount(), 2);
  await noIdentity();
});

test("falha ao salvar sessão reverte criação do cliente e bloqueia reutilização", async () => {
  const id = await challenge();
  await prisma.$executeRawUnsafe('ALTER TABLE "Sessao" ADD CONSTRAINT "test_reject_session" CHECK (false)');
  try {
    const response = await verificar(request({ desafioId: id, codigo: "0123" }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    await noIdentity();
    assert.equal((await prisma.desafioOtp.findUniqueOrThrow({ where: { id } })).estado, "PROCESSANDO");
    assert.equal((await verificar(request({ desafioId: id, codigo: "0123" }))).status, 409);
    assert.equal(fetch.mock.callCount(), 2);
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "Sessao" DROP CONSTRAINT "test_reject_session"');
  }
});

test("expiração durante a verificação não cria sessão mesmo com aprovação externa", async () => {
  const id = await challenge();
  fetch.mock.mockImplementation(async () => {
    await prisma.desafioOtp.update({ where: { id }, data: { expiraEm: new Date(0) } });
    return Response.json({ pinId: sentPin, verified: true });
  });
  assert.equal((await verificar(request({ desafioId: id, codigo: "0123" }))).status, 410);
  await noIdentity();
});

test("OTP errado preserva cliente preexistente não verificado", async () => {
  const before = await prisma.cliente.create({ data: { telefone, nome: "Original" } });
  const id = await challenge("Outro nome");
  fetch.mock.mockImplementation(async () => Response.json({ pinId: sentPin, verified: false, pinError: "WRONG_PIN" }));
  assert.equal((await verificar(request({ desafioId: id, codigo: "0123" }))).status, 422);
  assert.deepEqual(await prisma.cliente.findFirstOrThrow(), before);
  assert.equal(await prisma.sessao.count(), 0);
});
