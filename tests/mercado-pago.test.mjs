import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { prisma } from "../src/lib/prisma.ts";
import { alterarPagamento, criarPedido } from "../src/server/pedidos/service.ts";
import { processPayment, paymentView } from "../src/server/mercado-pago/service.ts";
import { normalizeOrder, orderPayload, mercadoPago } from "../src/server/mercado-pago/client.ts";
import { parsePayment } from "../src/server/mercado-pago/validation.ts";
import { POST, GET } from "../src/app/api/pedidos/[id]/pagamento/route.ts";
import { GET as config } from "../src/app/api/pagamentos/config/route.ts";
import { newToken, sessionCookieName, tokenHash } from "../src/server/auth/session.ts";
import { receiveOrderWebhook } from "../src/server/mercado-pago/webhook.ts";
import { reconcileAttempt } from "../src/server/mercado-pago/reconciliation.ts";

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
  mockEnv(t, "MERCADO_PAGO_CREDENTIAL_PAIR_SHA256", createHash("sha256").update(JSON.stringify(["test", "mock-private-access-token", "mock-public-key"])).digest("hex"));
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
const challengeUrl = "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/11111111-1111-4111-8111-111111111111?display_mode=self_hosted&guest_token=isolated_challenge_fixture";

function cardChallenge(pedido, url = challengeUrl) {
  const remote = external(pedido, "action_required", "pending_challenge");
  remote.transactions.payments[0].payment_method.transaction_security = { url };
  return remote;
}
async function unlock(id) { await prisma.tentativaPagamento.updateMany({ where: { pedidoId: id }, data: { bloqueadaAte: null } }); }
function req(id, body, key = randomUUID(), customCookie = cookie, origin = "http://localhost") {
  return POST(new Request(`http://localhost/api/pedidos/${id}/pagamento`, { method: "POST", headers: { cookie: customCookie, origin, "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}
test("leituras Pix são locais; recuperação autenticada tem intervalo compartilhado e não cria Order", async () => {
  const pedido = await order();
  respond(external(pedido));
  await req(pedido.id, pix);
  assert.equal(calls.length, 1);
  const ctx = { params: Promise.resolve({ id: pedido.id }) };
  const url = `http://localhost/api/pedidos/${pedido.id}/pagamento`;
  assert.equal((await GET(new Request(url, { headers: { cookie } }), ctx)).status, 200);
  assert.equal((await GET(new Request(url), ctx)).status, 401);
  assert.equal((await req(pedido.id, { consultar: true }, randomUUID(), "")).status, 401);
  await req(pedido.id, { consultar: true });
  assert.equal(calls.length, 1);

  await prisma.tentativaPagamento.updateMany({ where: { pedidoId: pedido.id }, data: { reconciliadaEm: new Date(0) } });
  await Promise.all(Array.from({ length: 5 }, () => req(pedido.id, { consultar: true })));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, undefined);
  assert.equal(await prisma.tentativaPagamento.count(), 1);
});

test("recuperação Pix sem ID usa busca com intervalo, inclusive quando a resposta é incerta", async () => {
  const pedido = await order();
  await req(pedido.id, pix);
  assert.equal(calls.length, 1);
  await prisma.tentativaPagamento.updateMany({ where: { pedidoId: pedido.id }, data: { bloqueadaAte: null, reconciliadaEm: new Date(0) } });
  respond({ data: [] });
  await req(pedido.id, { consultar: true });
  await unlock(pedido.id);
  await req(pedido.id, { consultar: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, undefined);
  assert.equal(await prisma.tentativaPagamento.count(), 1);
});
test("troca vence a corrida e uma cobrança que leu o método antigo não é reservada", async t => {
  const pedido = await order();
  const transaction = prisma.$transaction;
  let entered, resume;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  let first = true;
  prisma.$transaction = async (...args) => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    return transaction.apply(prisma, args);
  };
  t.after(() => { prisma.$transaction = transaction; });
  const attempt = req(pedido.id, pix);
  try {
    await waiting;
    const changed = await alterarPagamento(cliente.id, pedido.id, { formaPagamento: "CARTAO" });
    assert.equal(changed.formaPagamento, "CARTAO");
  } finally { resume(); }
  const stale = await attempt;
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).erro, "FORMA_PAGAMENTO_ALTERADA");
  assert.equal(await prisma.tentativaPagamento.count(), 0);
  assert.deepEqual(calls, []);
});

for (const method of ["PIX", "CARTAO"]) {
  test(`${method} reservado bloqueia troca durante resposta incerta e após aprovação`, async () => {
    const pedido = await order(method);
    let entered, resume;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    fetch.mock.mockImplementation(async (url, init) => {
      calls.push({ url, init });
      entered();
      await gate;
      return Response.json(external(pedido, "processed", "accredited"));
    });
    const payment = req(pedido.id, method === "PIX" ? pix : card);
    const cash = { formaPagamento: "DINHEIRO", precisaTroco: false };
    try {
      await waiting;
      await assert.rejects(alterarPagamento(cliente.id, pedido.id, cash), { code: "TROCA_PAGAMENTO_BLOQUEADA" });
    } finally { resume(); }
    assert.equal((await (await payment).json()).pedido.statusPagamento, "APROVADO");
    await assert.rejects(alterarPagamento(cliente.id, pedido.id, cash), { code: "TROCA_PAGAMENTO_BLOQUEADA" });
    assert.equal(await prisma.tentativaPagamento.count(), 1);
    assert.equal(calls.length, 1);
  });
}

test("tentativa definitivamente encerrada mantém o método para eventos tardios", async () => {
  const pedido = await order("CARTAO");
  respond(external(pedido, "failed", "failed"), 402);
  const initial = await processPayment(cliente.id, pedido.id, card, randomUUID());
  assert.equal(initial.tentativa.podeTentarNovamente, true);
  await assert.rejects(alterarPagamento(cliente.id, pedido.id, { formaPagamento: "PIX" }), { code: "TROCA_PAGAMENTO_BLOQUEADA" });
  assert.equal((await paymentView(cliente.id, pedido.id)).pedido.formaPagamento, "CARTAO");
});
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
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.total_amount, "8.00");
  assert.deepEqual(payload.config.online.transaction_security, { validation: "on_fraud_risk", liability_shift: "required" });
  const method = payload.transactions.payments[0].payment_method;
  assert.deepEqual(Object.keys(method).sort(), ["id", "installments", "token", "type"]);
});

test("3DS pendente recupera a URL por consulta do titular, preserva a cobrança única e aceita webhook tardio", async t => {
  const pedido = await order("CARTAO");
  const key = randomUUID();
  respond(cardChallenge(pedido));
  const initial = await processPayment(cliente.id, pedido.id, card, key);
  assert.equal(initial.desafio3dsUrl, challengeUrl);
  assert.equal(initial.pedido.statusPagamento, "PENDENTE");
  assert.equal(initial.pedido.liberadoParaPreparo, false);
  assert.equal(initial.tentativa.podeTentarNovamente, false);
  assert.equal(JSON.stringify(await prisma.tentativaPagamento.findMany()).includes("guest_token"), false);
  assert.equal((await paymentView(cliente.id, pedido.id)).desafio3dsUrl, undefined);
  assert.equal((await req(pedido.id, { consultar: true }, randomUUID(), "")).status, 401);
  assert.equal((await req(pedido.id, { consultar: true }, randomUUID(), cookie, "https://outro.invalid")).status, 403);
  await prisma.tentativaPagamento.updateMany({ where: { pedidoId: pedido.id }, data: { reconciliadaEm: new Date(0) } });
  const recovered = await (await req(pedido.id, { consultar: true })).json();
  assert.equal(recovered.desafio3dsUrl, challengeUrl);
  await req(pedido.id, card);
  assert.equal(await prisma.tentativaPagamento.count(), 1);
  assert.equal(calls.filter(call => call.init.method === "POST").length, 1);

  const secret = "isolated-card-webhook";
  mockEnv(t, "MERCADO_PAGO_WEBHOOK_SECRET", secret);
  const approved = external(pedido, "processed", "accredited");
  respond(approved);
  const requestId = randomUUID();
  const ts = String(Math.floor(Date.now() / 1000));
  const mac = createHmac("sha256", secret).update(`id:${approved.id};request-id:${requestId};ts:${ts};`).digest("hex");
  const jobs = [];
  const hook = new Request(`http://localhost/api/webhooks/mercado-pago?data.id=${approved.id}&type=order`, {
    method: "POST", headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${mac}` },
    body: JSON.stringify({ type: "order", data: { id: approved.id } }),
  });
  assert.equal((await receiveOrderWebhook(hook, job => jobs.push(job))).status, 200);
  await Promise.all(jobs.map(job => job()));
  const final = await paymentView(cliente.id, pedido.id);
  assert.equal(final.pedido.statusPagamento, "APROVADO");
  assert.equal(final.pedido.liberadoParaPreparo, true);
  assert.equal(final.desafio3dsUrl, undefined);
});

test("3DS rejeita destino fora do contrato e mantém tentativa ativa", async () => {
  const pedido = await order("CARTAO");
  for (const url of [
    challengeUrl.replace("https:", "http:"),
    challengeUrl.replace("www.mercadopago.com.br", "www.mercadopago.com.br.example.test"),
    challengeUrl.replace("/auth/card/validation/pages/remedies/", "/outra-pagina/"),
    challengeUrl + "&guest_token=duplicado",
  ]) {
    const state = normalizeOrder(cardChallenge(pedido, url), pedido);
    assert.equal(state.desafio3dsUrl, null);
    assert.equal(state.encerrada, false);
  }
});

for (const [status, detail, expected] of [
  ["failed", "cc_rejected_3ds_challenge", "RECUSADO"],
  ["failed", "invalid_card_token", "RECUSADO"],
  ["failed", "3ds_challenge_expired", "CANCELADO"],
  ["canceled", "expired", "CANCELADO"],
  ["processing", "in_review", "PENDENTE"],
]) test(`cartão processa estado documentado ${status}/${detail}`, async () => {
  const pedido = await order("CARTAO");
  respond(external(pedido, status, detail), status === "failed" ? 402 : 200);
  const result = await processPayment(cliente.id, pedido.id, card, randomUUID());
  assert.equal(result.pedido.statusPagamento, expected);
  assert.equal(result.tentativa.podeTentarNovamente, expected !== "PENDENTE");
  assert.equal(result.desafio3dsUrl, undefined);
});

test("retry de cartão anterior ao 3DS mantém corpo e chave recebidos originalmente", async () => {
  const pedido = await order("CARTAO");
  const originalPayload = orderPayload(pedido, parsePayment(card, "CARTAO"), false);
  const chaveCliente = randomUUID();
  const chaveProvedor = randomUUID();
  await prisma.tentativaPagamento.create({ data: {
    pedidoId: pedido.id, chaveCliente, chaveProvedor, statusLocal: "PENDENTE", envios: 1,
    metodoExterno: "visa", tipoMetodoExterno: "credit_card",
    requisicaoHash: createHash("sha256").update(JSON.stringify(originalPayload)).digest("hex"),
  } });
  respond(external(pedido, "processed", "accredited"));
  await processPayment(cliente.id, pedido.id, card, chaveCliente);
  assert.equal(calls[0].init.body, JSON.stringify(originalPayload));
  assert.equal(calls[0].init.headers["X-Idempotency-Key"], chaveProvedor);
  assert.equal(await prisma.tentativaPagamento.count(), 1);
});

test("token recusado no primeiro envio encerra, mas erro após resposta perdida mantém tentativa incerta", async () => {
  const primeiro = await order("CARTAO");
  const tokenError = { errors: [{ code: "invalid_card_token", message: "private fixture" }] };
  respond(tokenError, 400);
  const rejected = await processPayment(cliente.id, primeiro.id, card, randomUUID());
  assert.equal(rejected.pedido.statusPagamento, "RECUSADO");
  assert.equal(rejected.tentativa.codigoErro, "CARTAO_TOKEN_INVALIDO");
  assert.equal(rejected.tentativa.podeTentarNovamente, true);
  assert.equal(JSON.stringify(rejected).includes("private fixture"), false);

  const outro = await order("CARTAO");
  const key = randomUUID();
  fetch.mock.mockImplementation(async (url, init) => { calls.push({ url, init }); throw new DOMException("timeout", "TimeoutError"); });
  const pending = await processPayment(cliente.id, outro.id, card, key);
  assert.equal(pending.pedido.statusPagamento, "PENDENTE");
  assert.equal(pending.tentativa.codigoErro, "RESPOSTA_INCERTA");
  const firstSend = calls.at(-1);
  await unlock(outro.id);
  respond(tokenError, 400);
  const stillPending = await processPayment(cliente.id, outro.id, card, key);
  const repeated = calls.at(-1);
  assert.equal(repeated.init.body, firstSend.init.body);
  assert.equal(repeated.init.headers["X-Idempotency-Key"], firstSend.init.headers["X-Idempotency-Key"]);
  assert.equal(stillPending.pedido.statusPagamento, "PENDENTE");
  assert.equal(stillPending.tentativa.podeTentarNovamente, false);
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

test("detalhe OTHE exige falha final compatível na Order e na transação", () => {
  const pedido = { id: randomUUID(), formaPagamento: "CARTAO", totalCentavos: 800 };
  for (const [status, detail, paymentStatus, expected] of [
    ["failed", "failed", "failed", "RECUSADO"],
    ["pending", "pending", "failed", "PENDENTE"],
    ["action_required", "pending_challenge", "failed", "PENDENTE"],
    ["failed", "failed", "pending", "PENDENTE"],
    ["failed", "high_risk", "failed", "PENDENTE"],
  ]) {
    const snapshot = external(pedido, status, detail);
    Object.assign(snapshot.transactions.payments[0], { status: paymentStatus, status_detail: "3ds_challenge_failed" });
    const result = normalizeOrder(snapshot, pedido);
    assert.equal(result.localStatus, expected);
    assert.equal(result.encerrada, expected === "RECUSADO");
    assert.equal(result.codigoErro, expected === "RECUSADO" ? "CARTAO_3DS_RECUSADO" : null);
  }
});

test("reconciliação da Order OTHE encerra uma única vez e libera só uma nova tentativa", async () => {
  const pedido = await order("CARTAO");
  const key = randomUUID();
  respond(cardChallenge(pedido));
  await processPayment(cliente.id, pedido.id, card, key);
  const attempt = await prisma.tentativaPagamento.findFirstOrThrow({ where: { pedidoId: pedido.id } });
  assert.equal((await paymentView(cliente.id, pedido.id)).tentativa.podeTentarNovamente, false);
  const snapshot = external(pedido, "failed", "failed");
  snapshot.transactions.payments[0].status_detail = "3ds_challenge_failed";
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  fetch.mock.mockImplementation(async (url, init) => {
    calls.push({ url, init });
    enter();
    await gate;
    return Response.json(snapshot);
  });
  const reconciliation = reconcileAttempt(attempt.id);
  try {
    await entered;
    await assert.rejects(reconcileAttempt(attempt.id), { code: "RECONCILIACAO_OCUPADA" });
  } finally {
    release();
    await reconciliation;
  }
  assert.equal(calls.length, 2);
  respond(snapshot);
  await reconcileAttempt(attempt.id);
  const view = await (await GET(new Request("http://localhost", { headers: { cookie } }), {
    params: Promise.resolve({ id: pedido.id }),
  })).json();
  assert.equal(view.pedido.statusPagamento, "RECUSADO");
  assert.equal(view.pedido.liberadoParaPreparo, false);
  assert.equal(view.tentativa.codigoErro, "CARTAO_3DS_RECUSADO");
  assert.equal(view.tentativa.podeTentarNovamente, true);
  assert.equal(view.desafio3dsUrl, undefined);
  const stored = await prisma.tentativaPagamento.findUniqueOrThrow({ where: { id: attempt.id } });
  assert.equal(stored.encerrada, true);
  assert.equal(stored.orderId, snapshot.id);
  assert.equal(stored.chaveProvedor, attempt.chaveProvedor);
  await processPayment(cliente.id, pedido.id, card, key);
  assert.equal(calls.filter(call => call.init.method === "POST").length, 1);

  respond({ ...external(pedido, "processed", "accredited"), id: "ORD01JP84C939T20S0P1DN382FQ7K" });
  const nextKey = randomUUID();
  await Promise.all([processPayment(cliente.id, pedido.id, card, nextKey), processPayment(cliente.id, pedido.id, card, nextKey)]);
  assert.equal(calls.filter(call => call.init.method === "POST").length, 2);
  assert.equal(await prisma.tentativaPagamento.count({ where: { pedidoId: pedido.id } }), 2);
  assert.equal((await paymentView(cliente.id, pedido.id)).pedido.statusPagamento, "APROVADO");
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
