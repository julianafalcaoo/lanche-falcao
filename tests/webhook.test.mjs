import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { paymentMemory } from "./support/payment-memory.mjs";

// Nunca carrega .env. Mesmo uma consulta esquecida não alcançaria o banco da aplicação.
process.env.DATABASE_URL = "postgresql://localhost:1/lf_webhook_unit";
const { prisma } = await import("../src/lib/prisma.ts");
const { verifyOrderSignature } = await import("../src/server/mercado-pago/webhook-signature.ts");
const { receiveOrderWebhook, processOrderWebhook } = await import("../src/server/mercado-pago/webhook.ts");
const { reconcileAttempt, applyOrderSnapshot } = await import("../src/server/mercado-pago/reconciliation.ts");
const { processPayment, paymentView } = await import("../src/server/mercado-pago/service.ts");
const { reconciliationBatch } = await import("../src/server/mercado-pago/worker.ts");
const { POST: cron, GET: dailyCron } = await import("../src/app/api/interno/pagamentos/reconciliar/route.ts");
const orderId = "ORD01JP84C939T20S0P1DN382FQ6K";
const secret = "unit-test-signature-secret";
let memory, pedido, attempt, remote, calls, jobs;

function notification({ ts = String(Math.floor(Date.now() / 1000)), id = orderId, requestId = "request-01", hash, body, query = `data.id=${id}&type=order` } = {}) {
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const signature = hash ?? createHmac("sha256", secret).update(manifest).digest("hex");
  return new Request(`http://localhost/api/webhooks/mercado-pago?${query}`, {
    method: "POST", headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${signature}` },
    body: JSON.stringify(body ?? { type: "order", api_version: "v1", action: "order.processed", data: { id } }),
  });
}
const receive = request => receiveOrderWebhook(request, work => { jobs.push(work); });
async function drain() { for (const job of jobs.splice(0)) await job(); }
function state(status, detail) {
  remote.status = status; remote.status_detail = detail;
  remote.transactions.payments[0].status = status;
  remote.transactions.payments[0].status_detail = detail;
}
const storedOrder = () => memory.rows("pedido")[0];
const storedAttempt = () => memory.rows("tentativaPagamento").find(row => row.id === attempt.id);
const runDailyCron = () => dailyCron(new Request("http://localhost/api/interno/pagamentos/reconciliar", { headers: { authorization: "Bearer unit-daily-cron" } }));

beforeEach(t => {
  for (const [key, value] of Object.entries({ CRON_SECRET: "unit-daily-cron", MERCADO_PAGO_AMBIENTE: "test", MERCADO_PAGO_ACCESS_TOKEN: "unit-access", MERCADO_PAGO_PUBLIC_KEY: "unit-public", MERCADO_PAGO_WEBHOOK_SECRET: secret, MERCADO_PAGO_RECONCILIACAO_SECRET: "unit-worker" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  memory = paymentMemory(t, prisma);
  pedido = { id: randomUUID(), clienteId: randomUUID(), totalCentavos: 800, formaPagamento: "PIX", statusPagamento: "PENDENTE" };
  attempt = { id: randomUUID(), pedidoId: pedido.id, orderId, criadoEm: new Date(), chaveCliente: randomUUID(), chaveProvedor: randomUUID(), requisicaoHash: "saved-hash", statusLocal: "PENDENTE", statusExterno: "action_required", detalheExterno: "waiting_transfer", encerrada: false, bloqueadaAte: null, envios: 1, reconciliadaEm: null, metodoExterno: "pix", tipoMetodoExterno: "bank_transfer" };
  memory.insert("pedido", pedido); memory.insert("tentativaPagamento", attempt);
  remote = { id: orderId, type: "online", live_mode: false, external_reference: pedido.id, total_amount: "8.00", status: "processed", status_detail: "accredited", transactions: { payments: [{ amount: "8.00", status: "processed", status_detail: "accredited", payment_method: { id: "pix", type: "bank_transfer" } }] } };
  calls = []; jobs = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); assert.equal(init.method, undefined, "Webhook/reconciliação não podem criar transações"); assert.match(url, /^https:\/\/api\.mercadopago\.com\/v1\/orders/); return Response.json(remote); });
});
after(() => prisma.$disconnect());

test("assinatura fixa compatível com manifesto Node oficial, ID em caixa original", () => {
  const ts = "1792900000";
  const req = notification({ ts });
  assert.equal(verifyOrderSignature(req, secret, Number(ts) * 1000).orderId, orderId);
  const lowerHash = createHmac("sha256", secret).update(`id:${orderId.toLowerCase()};request-id:request-01;ts:${ts};`).digest("hex");
  assert.throws(() => verifyOrderSignature(notification({ ts, hash: lowerHash }), secret, Number(ts) * 1000), { status: 401 });
});
test("assinatura aceita timestamp Orders em milissegundos", () => {
  const ts = String(Date.now()); assert.equal(verifyOrderSignature(notification({ ts }), secret).orderId, orderId);
});
for (const offset of [-301000, 301000]) test(`assinatura fora da janela ${offset} rejeitada`, async () => {
  const response = await receive(notification({ ts: String(Date.now() + offset) }));
  assert.equal(response.status, 401); assert.equal(memory.rows("webhookOrder").length, 0); assert.equal(calls.length, 0);
});
for (const mutate of [
  req => req.headers.delete("x-signature"),
  req => req.headers.delete("x-request-id"),
  req => req.headers.set("x-signature", "ts=garbage,v1=abcdef"),
  req => req.headers.set("x-signature", req.headers.get("x-signature") + ",ts=1792900000"),
]) test("assinatura ausente/malformada/ambígua não chega ao banco", async () => {
  const req = notification(); mutate(req);
  assert.equal((await receive(req)).status, 401); assert.equal(memory.rows("webhookOrder").length, 0);
});
test("assinatura incorreta e query duplicada são recusadas", async () => {
  assert.equal((await receive(notification({ hash: "0".repeat(64) }))).status, 401);
  assert.equal((await receive(notification({ query: `data.id=${orderId}&data.id=${orderId}&type=order` }))).status, 401);
});
test("evento de outro tópico ou ID divergente não é persistido", async () => {
  for (const body of [{ type: "payment", data: { id: orderId } }, { type: "order", data: { id: "ORD0000000000000000000000" } }]) assert.equal((await receive(notification({ body }))).status, 400);
  assert.equal(memory.rows("webhookOrder").length, 0);
});
test("limite de corpo, JSON e content-type são validados", async () => {
  const oversized = notification({ body: { data: { id: orderId }, type: "order", extra: "x".repeat(65536) } });
  assert.equal((await receive(oversized)).status, 413);
  const req = notification(); req.headers.set("content-type", "text/plain");
  assert.equal((await receive(req)).status, 415);
  const valid = notification();
  assert.equal((await receive(new Request(valid.url, { method: "POST", headers: valid.headers, body: "{" }))).status, 400);
});
test("ausência de segredo e ambiente produtivo falham fechados", async () => {
  delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  assert.equal((await receive(notification())).status, 503);
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = secret; process.env.MERCADO_PAGO_AMBIENTE = "production";
  assert.equal((await receive(notification())).status, 503); assert.equal(calls.length, 0);
});
test("ACK ocorre após persistir; processamento posterior consulta API antes de aprovar", async () => {
  const response = await receive(notification());
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(storedOrder().statusPagamento, "PENDENTE"); assert.equal(calls.length, 0);
  assert.equal(memory.rows("webhookOrder").length, 1);
  await drain();
  assert.equal(storedOrder().statusPagamento, "APROVADO"); assert.ok(memory.rows("webhookOrder")[0].processadoEm);
  assert.equal(storedAttempt().qrCode, null); assert.equal(calls.length, 1);
});
test("falha de persistência não confirma recepção", async t => {
  prisma.webhookOrder.upsert = t.mock.fn(async () => { throw new Error("falha privada"); });
  const response = await receive(notification()); assert.equal(response.status, 503); assert.equal(jobs.length, 0);
  assert.equal(JSON.stringify(await response.json()).includes("privada"), false);
});
test("duplicatas concorrentes são persistidas uma vez e executam um GET", async () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const responses = await Promise.all([receive(notification({ ts })), receive(notification({ ts }))]);
  assert.ok(responses.every(row => row.status === 200)); assert.equal(memory.rows("webhookOrder").length, 1);
  await Promise.all(jobs.splice(0).map(job => job()));
  assert.equal(calls.length, 1);
  await receive(notification({ ts })); await drain(); assert.equal(calls.length, 1);
});
test("ID/action/status do corpo não controlam dedupe nem aprovação", async () => {
  state("action_required", "waiting_transfer");
  await receive(notification({ body: { type: "order", id: "forged", action: "order.processed", data: { id: orderId, status: "processed" } } }));
  await drain(); assert.equal(storedOrder().statusPagamento, "PENDENTE");
});
test("evento antigo consulta o estado atual, não o snapshot da notificação", async () => {
  await receive(notification({ body: { type: "order", action: "order.created", date_created: "2020-01-01", data: { id: orderId, status: "created" } } }));
  await drain(); assert.equal(storedOrder().statusPagamento, "APROVADO");
});
for (const [key, value] of [["id", "ORD0000000000000000000000"], ["external_reference", "other"], ["total_amount", "1.00"], ["live_mode", true], ["type", "qr"]]) test(`Order com ${key} divergente não altera pagamento`, async () => {
  remote[key] = value;
  await receive(notification()); await drain();
  assert.equal(storedOrder().statusPagamento, "PENDENTE"); assert.equal(memory.rows("webhookOrder")[0].processadoEm, null);
});
test("valor, método, quantidade de transações e vínculo da tentativa são obrigatórios", async () => {
  remote.transactions.payments[0].payment_method = { id: "visa", type: "credit_card" };
  await assert.rejects(reconcileAttempt(attempt.id));
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { bloqueadaAte: null } });
  remote.transactions.payments = [];
  await assert.rejects(reconcileAttempt(attempt.id));
  assert.equal(storedOrder().statusPagamento, "PENDENTE");
});
test("Order desconhecida não é vinculada por external_reference e permanece para retry", async () => {
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { orderId: null } });
  await receive(notification()); await drain();
  const event = memory.rows("webhookOrder")[0]; assert.equal(event.codigoErro, "ORDER_NAO_VINCULADA"); assert.equal(calls.length, 0);
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { orderId } });
  await prisma.webhookOrder.update({ where: { id: event.id }, data: { proximaExecucaoEm: new Date(0) } });
  await processOrderWebhook(event.id); assert.equal(storedOrder().statusPagamento, "APROVADO");
});
test("erro remoto deixa fila durável com backoff e sem vazar resposta", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ token: "private-secret" }, { status: 500 }));
  await receive(notification()); await drain();
  const event = memory.rows("webhookOrder")[0];
  assert.equal(event.processadoEm, null); assert.ok(event.proximaExecucaoEm > new Date()); assert.equal(event.reservaToken, null);
  assert.equal(JSON.stringify(event).includes("private-secret"), false);
});
test("reserva de worker interrompido expira e pode ser recuperada", async () => {
  await receive(notification()); const event = memory.rows("webhookOrder")[0]; jobs = [];
  await prisma.webhookOrder.update({ where: { id: event.id }, data: { reservadaAte: new Date(Date.now() + 90000), reservaToken: randomUUID() } });
  await processOrderWebhook(event.id); assert.equal(calls.length, 0);
  await prisma.webhookOrder.update({ where: { id: event.id }, data: { reservadaAte: new Date(0) } });
  await processOrderWebhook(event.id); assert.equal(storedOrder().statusPagamento, "APROVADO");
});
test("verificação manual e webhook concorrentes compartilham reserva e aplicação", async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const start = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, "fetch", async () => { calls.push({}); entered(); await gate; return Response.json(remote); });
  const manual = processPayment(pedido.clienteId, pedido.id); await start;
  await receive(notification()); await drain();
  assert.equal(memory.rows("webhookOrder")[0].codigoErro, "RECONCILIACAO_OCUPADA");
  release(); await manual;
  assert.equal(storedOrder().statusPagamento, "APROVADO"); assert.equal(calls.length, 1);
});
test("resposta de execução com lease vencido não substitui execução mais recente", async () => {
  const oldLease = new Date(Date.now() + 60000);
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { bloqueadaAte: new Date(oldLease.getTime() + 1) } });
  await assert.rejects(applyOrderSnapshot(attempt.id, oldLease, remote), { code: "RESERVA_EXPIRADA" });
  assert.equal(storedOrder().statusPagamento, "PENDENTE");
});
for (const [status, detail, expected] of [["refunded", "refunded", "ESTORNADO"], ["processed", "partially_refunded", "ESTORNADO_PARCIAL"], ["charged_back", "in_process", "CONTESTADO"], ["charged_back", "settled", "CONTESTADO"], ["charged_back", "reimbursed", "CONTESTADO"]]) test(`após aprovação: ${status}/${detail}`, async () => {
  await reconcileAttempt(attempt.id); state(status, detail);
  const view = await processPayment(pedido.clienteId, pedido.id);
  assert.equal(view.pedido.statusPagamento, expected); assert.equal(view.tentativa.podeTentarNovamente, false);
  const before = calls.length;
  await processPayment(pedido.clienteId, pedido.id, { iniciarPix: true }, randomUUID());
  assert.equal(calls.length, before); assert.equal(memory.rows("tentativaPagamento").length, 1);
});
test("recusa e expiração documentada permitem nova tentativa", async () => {
  state("failed", "expired"); await reconcileAttempt(attempt.id);
  assert.equal(storedOrder().statusPagamento, "CANCELADO");
  assert.equal((await paymentView(pedido.clienteId, pedido.id)).tentativa.podeTentarNovamente, true);
});
test("leitura regressiva não transforma aprovado ou estornado em pendente", async () => {
  await reconcileAttempt(attempt.id);
  state("processing", "in_process"); await reconcileAttempt(attempt.id);
  assert.equal(storedOrder().statusPagamento, "APROVADO");
  state("refunded", "refunded"); await reconcileAttempt(attempt.id);
  state("processed", "accredited"); await reconcileAttempt(attempt.id);
  assert.equal(storedOrder().statusPagamento, "ESTORNADO");
});
test("tentativa antiga recusada não apaga pagamento aprovado por outra", async () => {
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { encerrada: true, statusLocal: "RECUSADO" } });
  memory.insert("tentativaPagamento", { ...attempt, id: randomUUID(), orderId: "ORD01JP84C939T20S0P1DN382FQ7K", criadoEm: new Date(Date.now() + 1000), encerrada: true, statusLocal: "APROVADO" });
  await prisma.pedido.update({ where: { id: pedido.id }, data: { statusPagamento: "APROVADO" } });
  state("failed", "failed"); await reconcileAttempt(attempt.id);
  assert.equal(storedOrder().statusPagamento, "APROVADO");
});
test("cartão exige o mesmo identificador e tipo reservados na tentativa", async () => {
  await prisma.pedido.update({ where: { id: pedido.id }, data: { formaPagamento: "CARTAO" } });
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { metodoExterno: "visa", tipoMetodoExterno: "credit_card" } });
  remote.transactions.payments[0].payment_method = { id: "master", type: "credit_card" };
  await assert.rejects(reconcileAttempt(attempt.id), { code: "METODO_DIVERGENTE" });
  assert.equal(storedOrder().statusPagamento, "PENDENTE");
});
test("worker consulta pedidos sem navegador, inclusive já aprovados", async () => {
  await reconcileAttempt(attempt.id);
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { reconciliadaEm: new Date(0) } });
  state("refunded", "refunded");
  await reconciliationBatch(); assert.equal(storedOrder().statusPagamento, "ESTORNADO");
});
test("endpoint interno exige Bearer e não aceita cookie/Origin como autorização", async () => {
  assert.equal((await cron(new Request("http://localhost", { method: "POST" }))).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await cron(new Request("http://localhost", { method: "POST", headers: { authorization: "Bearer unit-worker" } }))).status, 200);
  assert.equal(storedOrder().statusPagamento, "APROVADO");
});

test("revisão antiga da API não sobrescreve estado mais recente, com precisão de nanossegundos", async () => {
  remote.last_updated_date = "2026-10-25T10:00:00.123456789Z";
  await reconcileAttempt(attempt.id);
  state("refunded", "refunded"); remote.last_updated_date = "2026-10-25T10:00:00.123456788Z";
  await reconcileAttempt(attempt.id);
  assert.equal(storedOrder().statusPagamento, "APROVADO");
  assert.equal(storedAttempt().atualizadaNoProvedor, "2026-10-25T10:00:00.123456789Z");
});
test("mesma revisão divergente ou revisão ausente não altera confirmação", async () => {
  remote.last_updated_date = "2026-10-25T10:00:00Z"; await reconcileAttempt(attempt.id);
  state("refunded", "refunded");
  await assert.rejects(reconcileAttempt(attempt.id), { code: "REVISAO_DIVERGENTE" });
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { bloqueadaAte: null } });
  delete remote.last_updated_date;
  await assert.rejects(reconcileAttempt(attempt.id), { code: "REVISAO_AUSENTE" });
  assert.equal(storedOrder().statusPagamento, "APROVADO");
});
test("contestação resolvida exige confirmação e revisão remota posterior", async () => {
  state("charged_back", "in_process"); remote.last_updated_date = "2026-10-25T10:00:00Z";
  await reconcileAttempt(attempt.id); assert.equal(storedOrder().statusPagamento, "CONTESTADO");
  state("processed", "accredited"); remote.last_updated_date = "2026-10-25T10:00:01Z";
  await reconcileAttempt(attempt.id); assert.equal(storedOrder().statusPagamento, "APROVADO");
  assert.equal((await paymentView(pedido.clienteId, pedido.id)).tentativa.podeTentarNovamente, false);
});
test("erro de consulta após aprovação preserva pagamento e não libera cobrança", async t => {
  await reconcileAttempt(attempt.id);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("timeout"); });
  await processPayment(pedido.clienteId, pedido.id);
  assert.equal(storedOrder().statusPagamento, "APROVADO");
  assert.equal((await paymentView(pedido.clienteId, pedido.id)).tentativa.podeTentarNovamente, false);
});
test("valor da transação divergente é rejeitado mesmo com total da Order correto", async () => {
  remote.transactions.payments[0].amount = "1.00";
  await assert.rejects(reconcileAttempt(attempt.id), { code: "RESPOSTA_INVALIDA" });
  assert.equal(storedOrder().statusPagamento, "PENDENTE");
});
test("worker recupera resposta perdida por busca e depois processa webhook desconhecido", async t => {
  await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { orderId: null } });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init }); assert.equal(init.method, undefined);
    return Response.json(url.includes("?") ? { data: [remote] } : remote);
  });
  await receive(notification()); jobs = [];
  await reconciliationBatch();
  assert.equal(storedAttempt().orderId, orderId); assert.equal(storedOrder().statusPagamento, "APROVADO");
  assert.ok(memory.rows("webhookOrder")[0].processadoEm);
});
test("cron GET aprova pendente somente após consultar a Order e repetição não cria cobrança", async () => {
  assert.equal(storedOrder().statusPagamento, "PENDENTE");
  const first = await runDailyCron();
  assert.equal(first.status, 200);assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await first.json(), { tentativasConsultadas: 1, notificacoesSelecionadas: 0 });
  assert.equal(calls.length, 1);assert.equal(storedOrder().statusPagamento, "APROVADO");
  assert.equal((await runDailyCron()).status, 200);assert.equal(calls.length, 1);
  assert.equal(memory.rows("tentativaPagamento").length, 1);
});

for (const [status, detail, expected] of [
  ["action_required", "waiting_transfer", "PENDENTE"],
  ["failed", "expired", "CANCELADO"],
  ["canceled", "canceled", "CANCELADO"],
  ["refunded", "refunded", "ESTORNADO"],
  ["processed", "partially_refunded", "ESTORNADO_PARCIAL"],
  ["charged_back", "in_process", "CONTESTADO"],
]) test(`cron GET reconcilia estado remoto ${status}/${detail}`, async () => {
  if (["ESTORNADO", "ESTORNADO_PARCIAL", "CONTESTADO"].includes(expected)) {
    await reconcileAttempt(attempt.id);
    await prisma.tentativaPagamento.update({ where: { id: attempt.id }, data: { reconciliadaEm: new Date(0) } });
    calls.length = 0;
  }
  state(status, detail);
  assert.equal((await runDailyCron()).status, 200);assert.equal(calls.length, 1);
  assert.equal(storedOrder().statusPagamento, expected);assert.equal(storedAttempt().statusLocal, expected);
});

test("cron GET com consulta recusada preserva pendente e registra falha para recuperação", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 401 }));
  assert.equal((await runDailyCron()).status, 200);
  assert.equal(storedOrder().statusPagamento, "PENDENTE");
  assert.equal(storedAttempt().codigoErro, "CREDENCIAL_RECUSADA");assert.ok(storedAttempt().bloqueadaAte > new Date());
});

test("cron GET com falha de infraestrutura retorna 503 sem diagnóstico privado", async t => {
  const original = prisma.tentativaPagamento.findMany;
  prisma.tentativaPagamento.findMany = t.mock.fn(async () => { throw new Error("private database detail"); });
  t.after(() => { prisma.tentativaPagamento.findMany = original; });
  const response = await runDailyCron();assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { erro: "RECONCILIACAO_INDISPONIVEL" });assert.equal(calls.length, 0);
});

test("cron GET concorrente respeita reserva de tentativa sem segunda consulta", async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init });assert.equal(init.method, undefined);entered();await gate;return Response.json(remote); });
  const first = runDailyCron();await started;
  try { assert.equal((await runDailyCron()).status, 200);assert.equal(calls.length, 1); }
  finally { release(); }
  assert.equal((await first).status, 200);assert.equal(storedOrder().statusPagamento, "APROVADO");
});

test("cron GET recupera notificação persistida sem execução após ACK", async () => {
  await receive(notification());jobs = [];
  assert.equal(memory.rows("webhookOrder")[0].processadoEm, null);
  assert.equal((await runDailyCron()).status, 200);
  assert.ok(memory.rows("webhookOrder")[0].processadoEm);
  assert.equal(memory.rows("webhookOrder")[0].codigoErro, null);
  assert.equal(storedOrder().statusPagamento, "APROVADO");
});

test("duplo clique de criação continua gerando uma só cobrança e uma só chave", async t => {
  memory.remove("tentativaPagamento", attempt.id);
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return Response.json(remote); });
  const key = randomUUID();
  await Promise.all([
    processPayment(pedido.clienteId, pedido.id, { iniciarPix: true }, key),
    processPayment(pedido.clienteId, pedido.id, { iniciarPix: true }, key),
  ]);
  assert.equal(calls.filter(row => row.init.method === "POST").length, 1);
  assert.equal(memory.rows("tentativaPagamento").length, 1);
  const row = memory.rows("tentativaPagamento")[0];
  assert.equal(calls[0].init.headers["X-Idempotency-Key"], row.chaveProvedor);
  assert.equal(storedOrder().statusPagamento, "APROVADO");
});
test("timeout na criação mantém chave e retry com conteúdo diferente conflita", async t => {
  memory.remove("tentativaPagamento", attempt.id);
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); throw new Error("timeout"); });
  const key = randomUUID();
  await processPayment(pedido.clienteId, pedido.id, { iniciarPix: true }, key);
  const row = memory.rows("tentativaPagamento")[0];
  await prisma.tentativaPagamento.update({ where: { id: row.id }, data: { bloqueadaAte: null } });
  await assert.rejects(processPayment(pedido.clienteId, pedido.id, { payer: { email: "other@testuser.com" } }, key), { status: 409 });
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return Response.json(remote); });
  await processPayment(pedido.clienteId, pedido.id, { iniciarPix: true }, key);
  assert.equal(calls[0].init.headers["X-Idempotency-Key"], calls[1].init.headers["X-Idempotency-Key"]);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(memory.rows("tentativaPagamento").length, 1);
});
