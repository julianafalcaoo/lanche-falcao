import "server-only";
import { paymentConfig, paymentEnvironment } from "./config.ts";
import { pixQrMime } from "../../lib/pix-qr.ts";
import { record, type PaymentInput } from "./validation.ts";

export class ProviderError extends Error {
  code: string;
  definitive: boolean;
  waitSeconds: number;
  constructor(code: string, definitive = false, waitSeconds = 5) { super(code); this.code = code; this.definitive = definitive; this.waitSeconds = waitSeconds; }
}
export const decimalAmount = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
export function orderPayload(pedido: { id: string; totalCentavos: number; formaPagamento: string | null }, input: PaymentInput, use3DS = true) {
  const amount = decimalAmount(pedido.totalCentavos);
  return { type: "online", processing_mode: "automatic", external_reference: pedido.id, total_amount: amount, payer: input.payer,
    ...(use3DS && input.card?.payment_type_id === "credit_card" ? {
      config: { online: { transaction_security: { validation: "on_fraud_risk", liability_shift: "required" } } },
    } : {}),
    transactions: { payments: [{ amount, payment_method: input.card
      ? { id: input.card.payment_method_id, type: input.card.payment_type_id, token: input.card.token, installments: input.card.installments }
      : { id: "pix", type: "bank_transfer" } }] } };
}
async function request(path: string, init: RequestInit = {}, cardCreation = false): Promise<unknown> {
  const { accessToken } = paymentConfig();
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/orders${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers } });
    const data: unknown = await response.json().catch(() => null);
    // HTTP 402 também pode conter uma Order criada, com transação recusada.
    if (response.ok || (response.status === 402 && record(data) && typeof data.id === "string")) return data;
    const wait = Number(response.headers.get("retry-after"));
    if (response.status === 401 || response.status === 403) throw new ProviderError("CREDENCIAL_RECUSADA", true);
    if (response.status === 400) {
      const tokenRejected = cardCreation && record(data) && Array.isArray(data.errors) &&
        data.errors.some(error => record(error) && error.code === "invalid_card_token");
      throw new ProviderError(tokenRejected ? "CARTAO_TOKEN_INVALIDO" : "DADOS_RECUSADOS", true);
    }
    throw new ProviderError(response.status === 409 ? "RECONCILIACAO_NECESSARIA" : "PROVEDOR_INDISPONIVEL", false, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 86400) : 5);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("RESPOSTA_INCERTA");
  }
}
export const mercadoPago = {
  create: (payload: ReturnType<typeof orderPayload>, key: string) => request("", { method: "POST", headers: { "X-Idempotency-Key": key }, body: JSON.stringify(payload) }, payload.transactions.payments[0].payment_method.type !== "bank_transfer"),
  get: (id: string) => request(`/${encodeURIComponent(id)}`),
  search: (pedidoId: string, since: Date) => request(`?${new URLSearchParams({ external_reference: pedidoId, type: "online", begin_date: new Date(since.getTime() - 60000).toISOString(), end_date: new Date().toISOString(), page: "1", page_size: "20" })}`),
};

const cardDeclines = new Set([
  "failed", "bad_filled_card_data", "invalid_card_token", "high_risk", "rejected_by_issuer",
  "required_call_for_authorize", "max_attempts_exceeded", "card_disabled", "insufficient_amount",
  "amount_limit_exceeded", "processing_error", "invalid_installments", "card_insufficient_amount",
  "cc_rejected_3ds_challenge", "3ds_challenge_expired",
]);

function approvedChallengeUrl(security: unknown): string | null {
  if (!record(security) || typeof security.url !== "string" || security.url.length > 2048) return null;
  try {
    const url = new URL(security.url);
    const hosts = ["www.mercadopago.com.br", "www.mercadopago.com.ar"];
    const tokens = url.searchParams.getAll("guest_token");
    if (url.protocol === "https:" && hosts.includes(url.hostname) && !url.port && !url.username && !url.password && !url.hash
      && /^\/auth\/card\/validation\/pages\/remedies\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(url.pathname)
      && url.searchParams.getAll("display_mode").length === 1 && url.searchParams.get("display_mode") === "self_hosted"
      && tokens.length === 1 && /^[a-zA-Z0-9_-]{16,256}$/.test(tokens[0])
      && [...url.searchParams.keys()].every(key => key === "display_mode" || key === "guest_token")) return url.toString();
  } catch { /* URLs fora do contrato não são expostas ao cliente. */ }
  return null;
}

export function normalizeOrder(value: unknown, pedido: { id: string; totalCentavos: number; formaPagamento: string | null }, expectedId?: string | null) {
  const invalid = () => new ProviderError("RESPOSTA_INVALIDA");
  const production = paymentEnvironment() === "production";
  const card = pedido.formaPagamento === "CARTAO";
  const detailPattern = card ? /^[a-z0-9_]{1,100}$/ : /^[a-z_]{1,100}$/;
  if (!record(value) || typeof value.id !== "string" || !/^ORD[a-zA-Z0-9]{10,60}$/.test(value.id) || (expectedId && value.id !== expectedId) || value.external_reference !== pedido.id || value.total_amount !== decimalAmount(pedido.totalCentavos) || value.type !== "online" ||
      (value.live_mode !== undefined && value.live_mode !== production) ||
      (value.currency !== undefined && value.currency !== "BRL") || (value.country_code !== undefined && value.country_code !== "BRA") ||
      typeof value.status !== "string" || !/^[a-z_]{1,80}$/.test(value.status) || typeof value.status_detail !== "string" || !detailPattern.test(value.status_detail)) throw invalid();
  // Respostas de cartão da Orders podem omitir live_mode. Em produção, exigir o formato
  // ORD documentado nesse caso e rejeitar a marca de sandbox mesmo com live_mode explícito.
  if (card && production && (/^ORDTST/i.test(value.id) ||
    (value.live_mode === undefined && !/^ORD[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value.id)))) throw invalid();
  const status = value.status, detail = value.status_detail;
  let atualizadaNoProvedor: string | null = null;
  if (value.last_updated_date !== undefined) {
    if (typeof value.last_updated_date !== "string") throw invalid();
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value.last_updated_date);
    const parsed = new Date(value.last_updated_date);
    if (!match || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== match[1]) throw invalid();
    // ISO UTC canônico com precisão de nanossegundos permite ordenação sem perder frações.
    atualizadaNoProvedor = `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}Z`;
  }
  const payments = record(value.transactions) ? value.transactions.payments : null;
  // Somente estados assíncronos documentados podem vincular uma Order sem transação.
  // Nunca inferir aprovação, método ou QR de uma resposta incompleta.
  const missingPayments = value.transactions === undefined || value.transactions === null ||
    (record(value.transactions) && (payments === undefined || payments === null || (Array.isArray(payments) && payments.length === 0)));
  if (missingPayments && ((status === "processing" && detail === "in_process") || (status === "created" && detail === "created"))) {
    return { orderId: value.id, statusExterno: status, detalheExterno: detail, localStatus: "PENDENTE", atualizadaNoProvedor,
      encerrada: false, qrCode: null, qrCodeBase64: null, ticketUrl: null, desafio3dsUrl: null, codigoErro: null } as const;
  }
  const payment = Array.isArray(payments) && payments.length === 1 && record(payments[0]) ? payments[0] : null;
  const method = payment && record(payment.payment_method) ? payment.payment_method : null;
  if (!payment || payment.amount !== decimalAmount(pedido.totalCentavos) || !method || typeof method.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(method.id) || (pedido.formaPagamento === "PIX" ? method.id !== "pix" || method.type !== "bank_transfer" : pedido.formaPagamento !== "CARTAO" || !["credit_card", "debit_card"].includes(String(method.type)))) throw invalid();
  // Aprovação exige estado documentado tanto da order quanto da transação.
  const approved = status === "processed" && detail === "accredited" && payment?.status === "processed" && payment?.status_detail === "accredited";
  if (approved && [value.total_paid_amount, payment.paid_amount].some(paid => paid != null && paid !== decimalAmount(pedido.totalCentavos))) throw invalid();
  const transactionDetail = typeof payment.status_detail === "string" ? payment.status_detail : "";
  // Orders sandbox (OTHE): Order failed/failed e transação failed/3ds_challenge_failed.
  const observedChallengeFailure = detail === "failed" && transactionDetail === "3ds_challenge_failed";
  const rejected = card ? status === "failed" && payment.status === "failed" &&
    ((cardDeclines.has(detail) && cardDeclines.has(transactionDetail)) || observedChallengeFailure)
    : status === "failed" && detail === "failed" && payment.status === "failed" && transactionDetail === "failed";
  const orderCanceled = (status === "canceled" && ["canceled", "expired"].includes(detail)) ||
    (["failed", "expired"].includes(status) && detail === "expired");
  const transactionCanceled = payment.status === "canceled" && ["canceled", "expired"].includes(transactionDetail) ||
    payment.status === "expired" && transactionDetail === "expired" ||
    payment.status === "failed" && (transactionDetail === "expired" || card && transactionDetail === "3ds_challenge_expired");
  const canceled = orderCanceled && transactionCanceled;
  const challengeExpired = card && ((canceled && detail === "expired") ||
    (rejected && (detail === "3ds_challenge_expired" || transactionDetail === "3ds_challenge_expired")));
  const codigoErro = challengeExpired && detail !== "expired" ? "CARTAO_3DS_EXPIRADO"
    : card && rejected && (observedChallengeFailure || [detail, transactionDetail].includes("cc_rejected_3ds_challenge")) ? "CARTAO_3DS_RECUSADO"
    : card && rejected && [detail, transactionDetail].includes("invalid_card_token") ? "CARTAO_TOKEN_INVALIDO" : null;
  const refunded = status === "refunded" && detail === "refunded";
  const partial = status === "processed" && detail === "partially_refunded";
  const disputed = status === "charged_back" && ["in_process", "settled", "reimbursed"].includes(detail);
  const localStatus = refunded ? "ESTORNADO" : partial ? "ESTORNADO_PARCIAL" : disputed ? "CONTESTADO" : approved ? "APROVADO" : canceled || challengeExpired ? "CANCELADO" : rejected ? "RECUSADO" : "PENDENTE";
  const challenge = card && status === "action_required" && detail === "pending_challenge"
    && payment.status === "action_required" && transactionDetail === "pending_challenge";
  const desafio3dsUrl = challenge ? approvedChallengeUrl(method.transaction_security) : null;
  const pix = pedido.formaPagamento === "PIX" && status === "action_required" && detail === "waiting_transfer" && payment?.status === "action_required";
  const qrCode = pix && typeof method?.qr_code === "string" && method.qr_code.length <= 10000 ? method.qr_code : null;
  const qrCodeBase64 = qrCode && typeof method?.qr_code_base64 === "string" && pixQrMime(method.qr_code_base64) ? method.qr_code_base64 : null;
  let ticketUrl: string | null = null;
  if (pix && typeof method?.ticket_url === "string") {
    try { const url = new URL(method.ticket_url); if (url.protocol === "https:" && url.hostname === "www.mercadopago.com.br" && !url.username && !url.password) ticketUrl = url.toString(); } catch { /* Never expose untrusted URLs. */ }
  }
  return { orderId: value.id, statusExterno: status, detalheExterno: detail, localStatus, metodoExterno: method.id, tipoMetodoExterno: String(method.type), atualizadaNoProvedor, encerrada: approved || rejected || canceled || refunded || partial || disputed, qrCode, qrCodeBase64, ticketUrl, desafio3dsUrl, codigoErro } as const;
}
