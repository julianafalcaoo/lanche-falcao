import type { CheckoutOrder } from "@/types/checkout-payment";

export class CheckoutRequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function checkoutRequest<T>(url: string, body?: object, options?: {
  key?: string; method?: "PATCH"; checkoutScope?: string; signal?: AbortSignal;
}): Promise<T> {
  const { key, method = body ? "POST" : "GET", checkoutScope, signal } = options ?? {};
  const timeout = AbortSignal.timeout(25000);
  const response = await fetch(url, { method, credentials: "same-origin", cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: body ? { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}),
      ...(checkoutScope ? { "Checkout-Scope": checkoutScope } : {}) } : undefined,
    body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error("A resposta não chegou. Atualize a situação ou repita a mesma tentativa com segurança."); });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new CheckoutRequestError(typeof result?.mensagem === "string" ? result.mensagem : "Não foi possível concluir. Tente novamente com segurança.", response.status);
  return result as T;
}
export function validOrder(value: unknown): value is CheckoutOrder {
  if (!value || typeof value !== "object") return false;
  const data = value as CheckoutOrder;
  return typeof data.id === "string" && /^[a-f0-9-]{36}$/i.test(data.id) && ["PIX", "DINHEIRO", "CARTAO"].includes(data.formaPagamento) && ["PENDENTE", "APROVADO", "RECUSADO", "CANCELADO", "ESTORNADO", "ESTORNADO_PARCIAL", "CONTESTADO"].includes(data.statusPagamento)
    && ["ENTREGA", "RETIRADA"].includes(data.tipo) && typeof data.status === "string"
    && Array.isArray(data.itens) && data.itens.length > 0 && data.itens.every(item => item &&
      typeof item.produtoId === "string" && typeof item.nomeProduto === "string" && Number.isSafeInteger(item.quantidade))
    && Number.isSafeInteger(data.subtotalCentavos) && data.subtotalCentavos > 0
    && Number.isSafeInteger(data.taxaEntregaCentavos) && data.taxaEntregaCentavos >= 0
    && Number.isSafeInteger(data.totalCentavos) && data.totalCentavos === data.subtotalCentavos + data.taxaEntregaCentavos;
}
