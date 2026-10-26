import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { prisma } from "../src/lib/prisma.ts";
import { criarPedido } from "../src/server/pedidos/service.ts";
import { processPayment, paymentView } from "../src/server/mercado-pago/service.ts";
import { normalizeOrder, orderPayload, mercadoPago } from "../src/server/mercado-pago/client.ts";
import { parsePayment } from "../src/server/mercado-pago/validation.ts";
import { POST, GET } from "../src/app/api/pedidos/[id]/pagamento/route.ts";
import { GET as config } from "../src/app/api/pagamentos/config/route.ts";
import { newToken, sessionCookieName, tokenHash } from "../src/server/auth/session.ts";

const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!/^lf_auth_test_[a-f0-9]{24}$/.test(database) || database !== process.env.AUTH_TEST_DATABASE) throw new Error("Use banco descartável.");
const pix = { payer: { email: "test@testuser.com" } };
const card = { payer: { email: "test@testuser.com", identification: { type: "CPF", number: "12345678909" } }, card: { token: "mock_card_token_123456", payment_method_id: "visa", payment_type_id: "credit_card", installments: 1 } };
function mockEnv(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}
let cliente, cookie, calls;
beforeEach(async t => {
  mockEnv(t, "MERCADO_PAGO_ACCESS_TOKEN", "mock-private-access-token");
  mockEnv(t, "MERCADO_PAGO_PUBLIC_KEY", "mock-public-key");
  mockEnv(t, "MERCADO_PAGO_AMBIENTE", "test");
  calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); throw new Error("Rede externa bloqueada"); });
  await prisma.pedido.deleteMany();
  await prisma.sessao.deleteMany();
  await prisma.cliente.deleteMany();
  cliente = await prisma.cliente.create({ data: { nome: "Teste isolado", telefone: "+5592999999999", telefoneVerificado: true } });
  const token = newToken();
  cookie = `${sessionCookieName()}=${token}`;
  await prisma.sessao.create({ data: { clienteId: cliente.id, tokenHash: tokenHash(token), expiraEm: new Date(Date.now() + 3600000) } });
});
after(() => prisma.$disconnect());
test("Pix automático usa somente fixture oficial no servidor sem alterar Cliente", async () => {
  const pedido = await order(), key = randomUUID();
  const customer = await prisma.cliente.findUnique({ where: { id: cliente.id } });
  respond(external(pedido));
  assert.equal((await req(pedido.id, { iniciarPix: true }, key)).status, 200);
  assert.deepEqual(JSON.parse(calls[0].init.body).payer, { email: "test_user_br@testuser.com", first_name: "APRO" });
  assert.deepEqual(await prisma.cliente.findUnique({ where: { id: cliente.id } }), customer);
  await req(pedido.id, { iniciarPix: true }, key);
  assert.equal(await prisma.tentativaPagamento.count(), 1);
  assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
});
test("fixture automática não funciona em produção nem aceita campos adicionais", async t => {
  const pedido = await order();
  assert.equal((await req(pedido.id, { iniciarPix: true, total_amount: "0.01" })).status, 422);
  mockEnv(t, "MERCADO_PAGO_AMBIENTE", "production");
  assert.equal((await req(pedido.id, { iniciarPix: true })).status, 503);
  assert.equal(calls.length, 0);
});
test("Pedido B e seu Pix não alteram snapshot ou tentativa pendente de A", async () => {
  const a = await order();
  respond(external(a));
  await processPayment(cliente.id, a.id, { iniciarPix: true }, randomUUID());
  const snapshot = await prisma.pedido.findUnique({ where: { id: a.id }, include: { itens: true } });
  const attempt = await prisma.tentativaPagamento.findFirst({ where: { pedidoId: a.id } });
  const b = (await criarPedido(cliente.id, randomUUID(), { tipo: "RETIRADA", formaPagamento: "PIX", itens: [{ productId: "coxinha-frango", quantity: 3 }] })).pedido;
  const remote = external(b); remote.id = "ORD01JP84C939T20S0P1DN382FQ7K"; remote.total_amount = "12.00"; remote.transactions.payments[0].amount = "12.00";
  respond(remote);
  await processPayment(cliente.id, b.id, { iniciarPix: true }, randomUUID());
  assert.notEqual(a.id, b.id);
  assert.deepEqual(await prisma.pedido.findUnique({ where: { id: a.id }, include: { itens: true } }), snapshot);
  assert.deepEqual(await prisma.tentativaPagamento.findFirst({ where: { pedidoId: a.id } }), attempt);
  assert.equal(await prisma.tentativaPagamento.count(), 2);
});
async function order(method = "PIX") {
  return (await criarPedido(cliente.id, randomUUID(), { tipo: "RETIRADA", formaPagamento: method, ...(method === "DINHEIRO" ? { precisaTroco: false } : {}), itens: [{ productId: "coxinha-frango", quantity: 2 }] })).pedido;
}
function external(pedido, status = "action_required", detail = "waiting_transfer") {
  return { id: "ORD01JP84C939T20S0P1DN382FQ6K", type: "online", external_reference: pedido.id, total_amount: "8.00", status, status_detail: detail,
    transactions: { payments: [{ amount: "8.00", status, status_detail: detail, payment_method: pedido.formaPagamento === "PIX" ? { id: "pix", type: "bank_transfer", qr_code: "pix-from-provider-mock", qr_code_base64: "iVBORw0KGgoAAAANSUhEUg==", ticket_url: "https://www.mercadopago.com.br/sandbox/payments/test/ticket" } : { id: "visa", type: "credit_card" } }] } };
}
function respond(data, status = 200) {
  fetch.mock.mockImplementation(async (url, init) => { calls.push({ url, init }); return Response.json(data, { status }); });
}
async function unlock(id) { await prisma.tentativaPagamento.updateMany({ where: { pedidoId: id }, data: { bloqueadaAte: null } }); }
function req(id, body, key = randomUUID(), customCookie = cookie, origin = "http://localhost") {
  return POST(new Request(`http://localhost/api/pedidos/${id}/pagamento`, { method: "POST", headers: { cookie: customCookie, origin, "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}
test("dinheiro cria pedido sem chamar Mercado Pago nem exigir credenciais", async t => {
  mockEnv(t, "MERCADO_PAGO_ACCESS_TOKEN", "");
  const pedido = await order("DINHEIRO");
  const view = await processPayment(cliente.id, pedido.id);
  assert.equal(view.pedido.statusPagamento, "PENDENTE");
  assert.equal(view.tentativa, null);
  assert.equal(calls.length, 0);
});
test("PIX usa Orders, total server-side, referência local e chave gerada pelo servidor", async () => {
  const pedido = await order(), key = randomUUID();
  respond(external(pedido));
  const view = await processPayment(cliente.id, pedido.id, pix, key);
  assert.equal(calls[0].url, "https://api.mercadopago.com/v1/orders");
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.total_amount, "8.00");
  assert.equal(sent.external_reference, pedido.id);
  assert.equal(sent.processing_mode, "automatic");
  assert.deepEqual(sent.transactions.payments[0].payment_method, { id: "pix", type: "bank_transfer" });
  assert.notEqual(calls[0].init.headers["X-Idempotency-Key"], key);
  assert.equal(view.pedido.statusPagamento, "PENDENTE");
  assert.equal(view.tentativa.qrCode, "pix-from-provider-mock");
  assert.equal(view.tentativa.qrCodeBase64, "iVBORw0KGgoAAAANSUhEUg==");
  assert.equal(JSON.stringify(view).includes("mock-private"), false);
});
test("cartão aprovado envia somente token/metadados e não persiste token ou pagador", async () => {
  const pedido = await order("CARTAO");
  respond(external(pedido, "processed", "accredited"));
  const view = await processPayment(cliente.id, pedido.id, card, randomUUID());
  assert.equal(view.pedido.statusPagamento, "APROVADO");
  const rows = await prisma.tentativaPagamento.findMany();
  for (const secret of ["mock_card_token", "test@testuser.com", "12345678909", "mock-private"]) {
    assert.equal(JSON.stringify(rows).includes(secret), false);
    assert.equal(JSON.stringify(view).includes(secret), false);
  }
  const method = JSON.parse(calls[0].init.body).transactions.payments[0].payment_method;
  assert.deepEqual(Object.keys(method).sort(), ["id", "installments", "token", "type"]);
});
test("HTTP 402 com Order recusada preserva referência e permite nova tentativa", async () => {
  const pedido = await order("CARTAO");
  respond(external(pedido, "failed", "failed"), 402);
  const view = await processPayment(cliente.id, pedido.id, card, randomUUID());
  assert.equal(view.pedido.statusPagamento, "RECUSADO");
  assert.equal(view.tentativa.podeTentarNovamente, true);
  const next = { ...external(pedido, "processed", "accredited"), id: "ORD01JP84C939T20S0P1DN382FQ7K" };
  respond(next);
  assert.equal((await processPayment(cliente.id, pedido.id, card, randomUUID())).pedido.statusPagamento, "APROVADO");
  assert.equal(await prisma.tentativaPagamento.count(), 2);
});
test("timeout conserva chave; retry repete o mesmo payload sem nova tentativa", async () => {
  const pedido = await order(), key = randomUUID();
  await processPayment(cliente.id, pedido.id, pix, key);
  const original = calls[0];
  await unlock(pedido.id);
  respond(external(pedido));
  await processPayment(cliente.id, pedido.id, pix, key);
  assert.equal(calls[1].init.headers["X-Idempotency-Key"], original.init.headers["X-Idempotency-Key"]);
  assert.equal(calls[1].init.body, original.init.body);
  assert.equal(await prisma.tentativaPagamento.count(), 1);
});
test("timeout com chave diferente não cria segunda cobrança; conteúdo diferente conflita", async () => {
  const pedido = await order(), key = randomUUID();
  await processPayment(cliente.id, pedido.id, pix, key);
  await unlock(pedido.id);
  await processPayment(cliente.id, pedido.id, pix, randomUUID());
  assert.equal(calls.length, 1);
  await assert.rejects(processPayment(cliente.id, pedido.id, { payer: { email: "other@testuser.com" } }, key), { status: 409 });
});
test("duplo clique concorrente chama provedor apenas uma vez", async () => {
  const pedido = await order(), key = randomUUID();
  respond(external(pedido));
  await Promise.all([processPayment(cliente.id, pedido.id, pix, key), processPayment(cliente.id, pedido.id, pix, key)]);
  assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
  assert.equal(await prisma.tentativaPagamento.count(), 1);
});
test("reload consulta Order conhecida e reconcilia aprovação sem novo POST", async () => {
  const pedido = await order();
  respond(external(pedido));
  await processPayment(cliente.id, pedido.id, pix, randomUUID());
  respond(external(pedido, "processed", "accredited"));
  const view = await processPayment(cliente.id, pedido.id);
  assert.equal(view.pedido.statusPagamento, "APROVADO");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, undefined);
  assert.equal(view.tentativa.qrCode, null);
});
test("resposta perdida recuperada por busca oficial sem persistir payload", async () => {
  const pedido = await order();
  await processPayment(cliente.id, pedido.id, pix, randomUUID());
  await unlock(pedido.id);
  fetch.mock.mockImplementation(async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.includes("?") ? { data: [external(pedido)] } : external(pedido));
  });
  const view = await processPayment(cliente.id, pedido.id);
  assert.equal(view.tentativa.qrCode, "pix-from-provider-mock");
  assert.match(calls[1].url, /orders\?external_reference=/);
  assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
});
test("busca vazia após timeout não libera nova cobrança", async () => {
  const pedido = await order();
  await processPayment(cliente.id, pedido.id, pix, randomUUID());
  await unlock(pedido.id);
  respond({ data: [] });
  const view = await processPayment(cliente.id, pedido.id);
  assert.equal(view.tentativa.podeTentarNovamente, false);
  assert.equal(view.tentativa.codigoErro, "RECONCILIACAO_NECESSARIA");
});
for (const [status, detail, local] of [
  ["created", "created", "PENDENTE"], ["processing", "in_process", "PENDENTE"], ["action_required", "waiting_capture", "PENDENTE"],
  ["action_required", "waiting_retry", "PENDENTE"], ["processed", "accredited", "APROVADO"], ["failed", "failed", "RECUSADO"],
  ["canceled", "canceled", "CANCELADO"], ["expired", "expired", "CANCELADO"], ["refunded", "refunded", "ESTORNADO"],
  ["charged_back", "in_process", "CONTESTADO"], ["processed", "partially_refunded", "ESTORNADO_PARCIAL"], ["new_state", "new_detail", "PENDENTE"],
]) test(`mapeamento explícito ${status}/${detail}`, async () => {
  const pedido = await order();
  const result = normalizeOrder(external(pedido, status, detail), pedido);
  assert.equal(result.localStatus, local);
  assert.equal(result.statusExterno, status);
});
for (const mutation of [
  { external_reference: randomUUID() }, { total_amount: "0.01" }, { live_mode: true }, { id: "invalid" }, { type: "other" },
]) test(`resposta inconsistente não aprova nem exibe QR: ${Object.keys(mutation)[0]}`, async () => {
  const pedido = await order();
  respond({ ...external(pedido), ...mutation });
  const view = await processPayment(cliente.id, pedido.id, pix, randomUUID());
  assert.equal(view.pedido.statusPagamento, "PENDENTE");
  assert.equal(view.tentativa.qrCode, null);
  assert.equal(view.tentativa.podeTentarNovamente, false);
});
test("resposta inválida e HTTP 200 não equivalem a aprovação", async () => {
  const pedido = await order();
  respond({ unexpected: true });
  const view = await processPayment(cliente.id, pedido.id, pix, randomUUID());
  assert.equal(view.tentativa.codigoErro, "RESPOSTA_INVALIDA");
  assert.equal(view.pedido.statusPagamento, "PENDENTE");
});
for (const code of [400, 401, 403, 409, 423, 429, 500]) test(`erro HTTP ${code} sanitizado`, async () => {
  const pedido = await order();
  respond({ message: "mock-private-access-token" }, code);
  const view = await processPayment(cliente.id, pedido.id, pix, randomUUID());
  assert.equal(JSON.stringify(view).includes("mock-private"), false);
  assert.equal(view.tentativa.podeTentarNovamente, [400, 401, 403].includes(code));
});
test("configuração ausente falha antes da reserva e da rede", async t => {
  mockEnv(t, "MERCADO_PAGO_ACCESS_TOKEN", "");
  const pedido = await order();
  await assert.rejects(processPayment(cliente.id, pedido.id, pix, randomUUID()), { status: 503 });
  assert.equal(calls.length, 0);
  assert.equal(await prisma.tentativaPagamento.count(), 0);
});
test("rotas exigem autenticação, ownership e Origin", async () => {
  const pedido = await order();
  assert.equal((await req(pedido.id, pix, randomUUID(), "")).status, 401);
  assert.equal((await req(pedido.id, pix, randomUUID(), cookie, "https://evil.example")).status, 403);
  assert.equal((await req(randomUUID(), pix)).status, 404);
  const another = await prisma.cliente.create({ data: { nome: "Outro", telefone: "+5592999999998", telefoneVerificado: true } });
  await assert.rejects(paymentView(another.id, pedido.id), { status: 404 });
  const response = await GET(new Request("http://localhost", { headers: { cookie } }), { params: Promise.resolve({ id: pedido.id }) });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 0);
});
test("Public Key é a única credencial exposta pela rota autenticada", async () => {
  const response = await config(new Request("http://localhost", { headers: { cookie } }));
  assert.deepEqual(await response.json(), { publicKey: "mock-public-key", ambiente: "test", payerEmail: "test@testuser.com" });
  assert.equal((await config(new Request("http://localhost"))).status, 401);
});
test("dados sensíveis/brutos, valores e status enviados pelo navegador são rejeitados", () => {
  for (const extra of [{ total_amount: "0.01" }, { status: "APROVADO" }, { clienteId: randomUUID() }, { card_number: "123" }, { cvv: "123" }]) {
    assert.throws(() => parsePayment({ ...card, ...extra }, "CARTAO"));
  }
  assert.throws(() => parsePayment({ ...card, card: { ...card.card, cvv: "123" } }, "CARTAO"));
  assert.throws(() => parsePayment({ payer: { email: "real@example.com" } }, "PIX"));
});
test("cliente HTTP usa timeout, Bearer no servidor e não segue redirecionamento", async () => {
  const pedido = await order(); respond(external(pedido));
  await mercadoPago.create(orderPayload(pedido, pix), randomUUID());
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.headers.Authorization, "Bearer mock-private-access-token");
});

test("erro definitivo depois de timeout não libera tentativa possivelmente cobrada", async () => {
  const pedido = await order(), key = randomUUID();
  await processPayment(cliente.id, pedido.id, pix, key);
  await unlock(pedido.id);
  respond({ error: "bad_request" }, 400);
  const view = await processPayment(cliente.id, pedido.id, pix, key);
  assert.equal(view.tentativa.podeTentarNovamente, false);
  assert.equal(view.pedido.statusPagamento, "PENDENTE");
});
test("retry acima da janela local só permite reconciliação, nunca novo POST", async () => {
  const pedido = await order(), key = randomUUID();
  await processPayment(cliente.id, pedido.id, pix, key);
  await prisma.tentativaPagamento.updateMany({ where: { pedidoId: pedido.id }, data: { criadoEm: new Date(Date.now() - 2 * 86400000), bloqueadaAte: null } });
  await processPayment(cliente.id, pedido.id, pix, key);
  assert.equal(calls.length, 1);
});
test("QR e ticket inseguros são descartados sem inventar substituto", async () => {
  const pedido = await order();
  const raw = external(pedido);
  raw.transactions.payments[0].payment_method.qr_code_base64 = "<svg onload=evil>";
  raw.transactions.payments[0].payment_method.ticket_url = "https://evil.example/pay";
  const value = normalizeOrder(raw, pedido);
  assert.equal(value.qrCodeBase64, null);
  assert.equal(value.ticketUrl, null);
});
