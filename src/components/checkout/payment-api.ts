import type { CheckoutOrder } from "@/types/checkout-payment";

export class CheckoutRequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function checkoutRequest<T>(url: string, body?: object, key?: string): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(25000),
    headers: body ? { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) } : undefined,
    body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error("A resposta não chegou. Atualize a situação ou repita a mesma tentativa com segurança."); });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new CheckoutRequestError(typeof result?.mensagem === "string" ? result.mensagem : "Não foi possível concluir. Tente novamente com segurança.", response.status);
  return result as T;
}
export function validOrder(value: unknown): value is CheckoutOrder {
  if (!value || typeof value !== "object") return false;
  const data = value as CheckoutOrder;
  return typeof data.id === "string" && /^[a-f0-9-]{36}$/i.test(data.id) && ["PIX", "DINHEIRO", "CARTAO"].includes(data.formaPagamento) && ["PENDENTE", "APROVADO", "RECUSADO", "CANCELADO", "ESTORNADO", "ESTORNADO_PARCIAL", "CONTESTADO"].includes(data.statusPagamento) && Number.isSafeInteger(data.totalCentavos) && data.totalCentavos > 0;
}
