import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { paymentMemory } from "./support/payment-memory.mjs";

// Não lê .env, não conecta banco, não envia SMS e não permite rede externa.
process.env.DATABASE_URL = "postgresql://127.0.0.1:1/production_unit";
const { prisma } = await import("../src/lib/prisma.ts");
const { paymentConfig, paymentEnvironment } = await import("../src/server/mercado-pago/config.ts");
const { parsePayment } = await import("../src/server/mercado-pago/validation.ts");
const { sandboxPixInput, sandboxCardEmail } = await import("../src/server/mercado-pago/sandbox.ts");
const { normalizeOrder } = await import("../src/server/mercado-pago/client.ts");
const { processPayment, paymentView } = await import("../src/server/mercado-pago/service.ts");
const { reconcileAttempt } = await import("../src/server/mercado-pago/reconciliation.ts");
const { receiveOrderWebhook } = await import("../src/server/mercado-pago/webhook.ts");
const { canPrepare } = await import("../src/server/mercado-pago/states.ts");
const { GET: configRoute } = await import("../src/app/api/pagamentos/config/route.ts");
const { sessionCookieName } = await import("../src/server/auth/session.ts");
const privateKey = "APP_USR-unit-private-not-a-real-credential";
const publicKey = "APP_USR-unit-public-not-a-real-credential";
const payer = { email: "comprador@dominio.com.br" };
let memory, pedido, calls, response;
const orderId = "ORDproduction000000000001";
function remote(status = "processing", status_detail = "in_process", method = "pix") {
  return { id: orderId, type: "online", live_mode: true, currency: "BRL", country_code: "BRA", external_reference: pedido.id,
    total_amount: "8.00", status, status_detail,
    transactions: { payments: [{ amount: "8.00", status, status_detail,
      payment_method: { id: method, type: method === "pix" ? "bank_transfer" : "credit_card" } }] } };
}
beforeEach(t => {
  for (const [key, value] of Object.entries({ MERCADO_PAGO_AMBIENTE: "production", MERCADO_PAGO_ACCESS_TOKEN: privateKey,
    MERCADO_PAGO_PUBLIC_KEY: publicKey, MERCADO_PAGO_WEBHOOK_SECRET: "production-unit-secret" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  memory = paymentMemory(t, prisma);
  pedido = { id: randomUUID(), clienteId: randomUUID(), formaPagamento: "PIX", status: "PEDIDO_RECEBIDO", statusPagamento: "PENDENTE", totalCentavos: 800 };
  memory.insert("pedido", pedido);
  calls = []; response = remote();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.match(url, /^https:\/\/api\.mercadopago\.com\/v1\/orders/);
    calls.push({ url, init }); return Response.json(response);
  });
});
after(() => prisma.$disconnect());

test("ambiente explícito e credenciais inválidas falham sem rede ou vazamento", () => {
  assert.equal(paymentConfig().environment, "production");
  for (const environment of [undefined, "", "prod", "TEST"]) {
    if (environment === undefined) delete process.env.MERCADO_PAGO_AMBIENTE;
    else process.env.MERCADO_PAGO_AMBIENTE = environment;
    assert.throws(paymentEnvironment, { code: "PAGAMENTO_CONFIGURACAO" });
  }
  process.env.MERCADO_PAGO_AMBIENTE = "production";
  for (const key of ["MERCADO_PAGO_PUBLIC_KEY", "MERCADO_PAGO_ACCESS_TOKEN"]) {
    const original = process.env[key];
    for (const invalid of ["", "TEST-test-key", "APP_USR-with space", publicKey]) {
      process.env[key] = invalid;
      if (key === "MERCADO_PAGO_PUBLIC_KEY" && invalid === publicKey) continue;
      assert.throws(paymentConfig, error => error.code === "PAGAMENTO_CONFIGURACAO" && !error.message.includes(privateKey));
    }
    process.env[key] = original;
  }
  assert.equal(calls.length, 0);
});

test("pagador real é obrigatório; fixtures só funcionam em test", () => {
  assert.deepEqual(parsePayment({ payer }, "PIX"), { payer });
  for (const email of [undefined, "", "sem-email", "a@testuser.com", "a@example.com", "a@b.com\r\nX: y"]) {
    assert.throws(() => parsePayment({ payer: { email } }, "PIX"), { status: 422 });
  }
  assert.throws(() => parsePayment({ payer: { ...payer, first_name: "APRO" } }, "PIX"), { status: 422 });
  assert.throws(sandboxPixInput, { status: 422 }); assert.throws(sandboxCardEmail, { status: 422 });
  process.env.MERCADO_PAGO_AMBIENTE = "test";
  assert.equal(sandboxPixInput().payer.first_name, "APRO");
  assert.equal(sandboxCardEmail(), "test@testuser.com");
  assert.throws(() => parsePayment({ payer }, "PIX"), { status: 422 });
});

test("respostas live são exclusivas de produção e valores/vínculo/moeda são validados", () => {
  const approved = remote("processed", "accredited");
  assert.equal(normalizeOrder(approved, pedido).localStatus, "APROVADO");
  for (const mismatch of [{ live_mode: false }, { live_mode: undefined }, { live_mode: "true" },
    { total_amount: "0.01" }, { external_reference: randomUUID() }, { currency: "USD" }, { country_code: "ARG" }]) {
    assert.throws(() => normalizeOrder({ ...approved, ...mismatch }, pedido));
  }
  process.env.MERCADO_PAGO_AMBIENTE = "test";
  assert.throws(() => normalizeOrder(approved, pedido));
  assert.equal(normalizeOrder({ ...approved, live_mode: false }, pedido).localStatus, "APROVADO");
  assert.equal(normalizeOrder({ ...approved, live_mode: undefined }, pedido).localStatus, "APROVADO");
});

for (const transactions of [undefined, null, {}, { payments: [] }, { payments: null }]) {
  test(`Order assíncrona ${JSON.stringify(transactions)} persiste ID e consulta sem nova cobrança`, async () => {
    response = { ...remote(), transactions };
    const key = randomUUID();
    const pending = await processPayment(pedido.clienteId, pedido.id, { payer }, key);
    assert.equal(pending.pedido.liberadoParaPreparo, false);
    const attempt = memory.rows("tentativaPagamento")[0];
    assert.equal(attempt.orderId, orderId); assert.equal(attempt.encerrada, false);
    assert.equal(attempt.metodoExterno, "pix"); assert.equal(attempt.statusLocal, "PENDENTE");
    assert.deepEqual(JSON.parse(calls[0].init.body).payer, payer);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${privateKey}`);
    await processPayment(pedido.clienteId, pedido.id, { payer }, randomUUID());
    assert.equal(memory.rows("tentativaPagamento").length, 1);
    response = remote("processed", "accredited");
    await reconcileAttempt(attempt.id);
    const approved = await paymentView(pedido.clienteId, pedido.id);
    assert.equal(approved.pedido.statusPagamento, "APROVADO"); assert.equal(approved.pedido.liberadoParaPreparo, true);
    assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
    assert.equal(calls[0].init.headers["X-Idempotency-Key"], attempt.chaveProvedor);
  });
}

test("resposta sem transação nunca aprova e payload malformado não é tratado como assíncrono", () => {
  for (const state of [["processed", "accredited"], ["failed", "failed"], ["action_required", "pending_challenge"]]) {
    assert.throws(() => normalizeOrder({ ...remote(...state), transactions: undefined }, pedido));
  }
  for (const transactions of [[], "invalid", { payments: {} }, { payments: [{}, {}] }]) {
    assert.throws(() => normalizeOrder({ ...remote(), transactions }, pedido));
  }
});

test("Pix automático sem dados reais é recusado antes de reservar/criar cobrança", async () => {
  await assert.rejects(processPayment(pedido.clienteId, pedido.id, { iniciarPix: true }, randomUUID()), { status: 422 });
  assert.equal(calls.length, 0); assert.equal(memory.rows("tentativaPagamento").length, 0);
});

test("cartão real: recusa libera nova tentativa no mesmo pedido e aprovação impede recobrança", async () => {
  await prisma.pedido.update({ where: { id: pedido.id }, data: { formaPagamento: "CARTAO" } });
  const body = { payer, card: { token: "unit_token_not_real_123456", payment_method_id: "visa", payment_type_id: "credit_card", installments: 1 } };
  response = remote("failed", "failed", "visa");
  const rejected = await processPayment(pedido.clienteId, pedido.id, body, randomUUID());
  assert.equal(rejected.pedido.statusPagamento, "RECUSADO"); assert.equal(rejected.pedido.liberadoParaPreparo, false);
  assert.equal(rejected.tentativa.podeTentarNovamente, true);
  response = { ...remote("processed", "accredited", "visa"), id: "ORDproduction000000000002" };
  const approved = await processPayment(pedido.clienteId, pedido.id, { ...body, card: { ...body.card, token: "unit_new_token_not_real_123456" } }, randomUUID());
  assert.equal(approved.pedido.liberadoParaPreparo, true);
  await processPayment(pedido.clienteId, pedido.id, body, randomUUID());
  assert.equal(calls.filter(call => call.init.method === "POST").length, 2);
  assert.equal(memory.rows("pedido").length, 1);
});

test("timeout em produção conserva chave/payload e bloqueia nova cobrança", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("timeout"); });
  const key = randomUUID();
  const pending = await processPayment(pedido.clienteId, pedido.id, { payer }, key);
  assert.equal(pending.tentativa.podeTentarNovamente, false);
  assert.equal(pending.pedido.liberadoParaPreparo, false);
  await processPayment(pedido.clienteId, pedido.id, { payer }, randomUUID());
  assert.equal(memory.rows("tentativaPagamento").length, 1);
  await assert.rejects(processPayment(pedido.clienteId, pedido.id, { payer: { email: "outro@dominio.com.br" } }, key), { code: "IDEMPOTENCIA_CONFLITO" });
});

test("Order assíncrona não pode trocar método reservado nem regredir uma aprovação", async () => {
  response = { ...remote(), transactions: undefined };
  await processPayment(pedido.clienteId, pedido.id, { payer }, randomUUID());
  const attempt = memory.rows("tentativaPagamento")[0];
  response = remote("processed", "accredited", "visa");
  await assert.rejects(reconcileAttempt(attempt.id));
  assert.equal((await paymentView(pedido.clienteId, pedido.id)).pedido.liberadoParaPreparo, false);
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { bloqueadaAte: null } });
  response = remote("processed", "accredited");
  await reconcileAttempt(attempt.id);
  response = { ...remote(), transactions: undefined };
  await reconcileAttempt(attempt.id);
  const view = await paymentView(pedido.clienteId, pedido.id);
  assert.equal(view.pedido.statusPagamento, "APROVADO");
  assert.equal(view.pedido.liberadoParaPreparo, true);
  assert.equal(view.tentativa.podeTentarNovamente, false);
});

test("resposta live incompatível permanece incerta sem autorizar nova tentativa", async () => {
  response = { ...remote("processed", "accredited"), live_mode: false };
  const result = await processPayment(pedido.clienteId, pedido.id, { payer }, randomUUID());
  assert.equal(result.pedido.statusPagamento, "PENDENTE");
  assert.equal(result.pedido.liberadoParaPreparo, false);
  assert.equal(result.tentativa.podeTentarNovamente, false);
  assert.equal(result.tentativa.codigoErro, "RESPOSTA_INVALIDA");
});

test("webhook de produção só libera após assinatura e consulta autenticada", async () => {
  await processPayment(pedido.clienteId, pedido.id, { payer }, randomUUID());
  const ts = String(Date.now()), requestId = "unit-production-hook";
  const manifest = `id:${orderId};request-id:${requestId};ts:${ts};`;
  const signature = createHmac("sha256", process.env.MERCADO_PAGO_WEBHOOK_SECRET).update(manifest).digest("hex");
  const request = hash => new Request(`https://app.invalid/api/webhooks/mercado-pago?data.id=${orderId}&type=order`, {
    method: "POST", headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${hash}` },
    body: JSON.stringify({ type: "order", data: { id: orderId, status: "processed" } }),
  });
  const jobs = [];
  assert.equal((await receiveOrderWebhook(request("0".repeat(64)), job => jobs.push(job))).status, 401);
  assert.equal((await receiveOrderWebhook(request(signature), job => jobs.push(job))).status, 200);
  assert.equal((await paymentView(pedido.clienteId, pedido.id)).pedido.liberadoParaPreparo, false);
  response = remote("processed", "accredited");
  await jobs[0]();
  assert.equal((await paymentView(pedido.clienteId, pedido.id)).pedido.liberadoParaPreparo, true);
});

test("configuração pública não expõe token nem inventa pagador em produção", async t => {
  const original = prisma.sessao.findUnique;
  prisma.sessao.findUnique = t.mock.fn(async () => ({ expiraEm: new Date(Date.now() + 60000), cliente: { id: pedido.clienteId, telefoneVerificado: true } }));
  t.after(() => { prisma.sessao.findUnique = original; });
  const result = await configRoute(new Request("https://app.invalid/api/pagamentos/config", { headers: { cookie: `${sessionCookieName()}=${"a".repeat(43)}` } }));
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.deepEqual(data, { publicKey, ambiente: "production", payerEmail: null });
  assert.equal(JSON.stringify(data).includes(privateKey), false);
});

test("pedido criado, recusado, estornado ou contestado não autoriza preparo", () => {
  for (const method of [null, "PIX", "CARTAO", "DINHEIRO"]) {
    for (const status of [null, "PENDENTE", "RECUSADO", "CANCELADO", "ESTORNADO", "ESTORNADO_PARCIAL", "CONTESTADO"]) assert.equal(canPrepare(method, status), false);
  }
  assert.equal(canPrepare("PIX", "APROVADO"), true); assert.equal(canPrepare("CARTAO", "APROVADO"), true);
  assert.equal(canPrepare("DINHEIRO", "APROVADO"), false);
});
