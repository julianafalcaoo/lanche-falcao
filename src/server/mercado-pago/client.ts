import "server-only";
import { paymentConfig, paymentEnvironment } from "./config.ts";
import { record, type PaymentInput } from "./validation.ts";

export class ProviderError extends Error {
  code: string;
  definitive: boolean;
  waitSeconds: number;
  constructor(code: string, definitive = false, waitSeconds = 5) { super(code); this.code = code; this.definitive = definitive; this.waitSeconds = waitSeconds; }
}
export const decimalAmount = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
export function orderPayload(pedido: { id: string; totalCentavos: number; formaPagamento: string | null }, input: PaymentInput) {
  const amount = decimalAmount(pedido.totalCentavos);
  return { type: "online", processing_mode: "automatic", external_reference: pedido.id, total_amount: amount, payer: input.payer,
    transactions: { payments: [{ amount, payment_method: input.card
      ? { id: input.card.payment_method_id, type: input.card.payment_type_id, token: input.card.token, installments: input.card.installments }
      : { id: "pix", type: "bank_transfer" } }] } };
}
async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const { accessToken } = paymentConfig();
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/orders${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers } });
    const data: unknown = await response.json().catch(() => null);
    // HTTP 402 também pode conter uma Order criada, com transação recusada.
    if (response.ok || (response.status === 402 && record(data) && typeof data.id === "string")) return data;
    const wait = Number(response.headers.get("retry-after"));
    if (response.status === 401 || response.status === 403) throw new ProviderError("CREDENCIAL_RECUSADA", true);
    if (response.status === 400) throw new ProviderError("DADOS_RECUSADOS", true);
    throw new ProviderError(response.status === 409 ? "RECONCILIACAO_NECESSARIA" : "PROVEDOR_INDISPONIVEL", false, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 86400) : 5);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("RESPOSTA_INCERTA");
  }
}
export const mercadoPago = {
  create: (payload: ReturnType<typeof orderPayload>, key: string) => request("", { method: "POST", headers: { "X-Idempotency-Key": key }, body: JSON.stringify(payload) }),
  get: (id: string) => request(`/${encodeURIComponent(id)}`),
  search: (pedidoId: string, since: Date) => request(`?${new URLSearchParams({ external_reference: pedidoId, type: "online", begin_date: new Date(since.getTime() - 60000).toISOString(), end_date: new Date().toISOString(), page: "1", page_size: "20" })}`),
};

export function normalizeOrder(value: unknown, pedido: { id: string; totalCentavos: number; formaPagamento: string | null }, expectedId?: string | null) {
  const invalid = () => new ProviderError("RESPOSTA_INVALIDA");
  const production = paymentEnvironment() === "production";
  if (!record(value) || typeof value.id !== "string" || !/^ORD[a-zA-Z0-9]{10,60}$/.test(value.id) || (expectedId && value.id !== expectedId) || value.external_reference !== pedido.id || value.total_amount !== decimalAmount(pedido.totalCentavos) || value.type !== "online" ||
      (production ? value.live_mode !== true : value.live_mode !== undefined && value.live_mode !== false) ||
      (value.currency !== undefined && value.currency !== "BRL") || (value.country_code !== undefined && value.country_code !== "BRA") ||
      typeof value.status !== "string" || !/^[a-z_]{1,80}$/.test(value.status) || typeof value.status_detail !== "string" || !/^[a-z_]{1,100}$/.test(value.status_detail)) throw invalid();
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
      encerrada: false, qrCode: null, qrCodeBase64: null, ticketUrl: null } as const;
  }
  const payment = Array.isArray(payments) && payments.length === 1 && record(payments[0]) ? payments[0] : null;
  const method = payment && record(payment.payment_method) ? payment.payment_method : null;
  if (!payment || payment.amount !== decimalAmount(pedido.totalCentavos) || !method || typeof method.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(method.id) || (pedido.formaPagamento === "PIX" ? method.id !== "pix" || method.type !== "bank_transfer" : pedido.formaPagamento !== "CARTAO" || !["credit_card", "debit_card"].includes(String(method.type)))) throw invalid();
  // Aprovação exige estado documentado tanto da order quanto da transação.
  const approved = status === "processed" && detail === "accredited" && payment?.status === "processed" && payment?.status_detail === "accredited";
  const rejected = status === "failed" && detail === "failed";
  const canceled = (status === "canceled" && ["canceled", "expired"].includes(detail)) || (status === "failed" && detail === "expired") || (status === "expired" && detail === "expired");
  const refunded = status === "refunded" && detail === "refunded";
  const partial = status === "processed" && detail === "partially_refunded";
  const disputed = status === "charged_back" && ["in_process", "settled", "reimbursed"].includes(detail);
  const localStatus = refunded ? "ESTORNADO" : partial ? "ESTORNADO_PARCIAL" : disputed ? "CONTESTADO" : approved ? "APROVADO" : rejected ? "RECUSADO" : canceled ? "CANCELADO" : "PENDENTE";
  const pix = pedido.formaPagamento === "PIX" && status === "action_required" && detail === "waiting_transfer" && payment?.status === "action_required";
  const qrCode = pix && typeof method?.qr_code === "string" && method.qr_code.length <= 10000 ? method.qr_code : null;
  const qrCodeBase64 = qrCode && typeof method?.qr_code_base64 === "string" && method.qr_code_base64.length <= 500000 && /^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(method.qr_code_base64) ? method.qr_code_base64 : null;
  let ticketUrl: string | null = null;
  if (pix && typeof method?.ticket_url === "string") {
    try { const url = new URL(method.ticket_url); if (url.protocol === "https:" && url.hostname === "www.mercadopago.com.br" && !url.username && !url.password) ticketUrl = url.toString(); } catch { /* Never expose untrusted URLs. */ }
  }
  return { orderId: value.id, statusExterno: status, detalheExterno: detail, localStatus, metodoExterno: method.id, tipoMetodoExterno: String(method.type), atualizadaNoProvedor, encerrada: approved || rejected || canceled || refunded || partial || disputed, qrCode, qrCodeBase64, ticketUrl } as const;
}
