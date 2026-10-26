export type PaymentStatus = "PENDENTE" | "APROVADO" | "RECUSADO" | "CANCELADO" | "ESTORNADO" | "ESTORNADO_PARCIAL" | "CONTESTADO";

export const hasPaid = (status: string | null) => ["APROVADO", "ESTORNADO", "ESTORNADO_PARCIAL", "CONTESTADO"].includes(status ?? "");

/** Sem revisão remota confiável, nunca reabrir cobrança por uma leitura regressiva. */
export function acceptsTransition(previous: string | null, next: PaymentStatus) {
  if (previous === "ESTORNADO") return next === "ESTORNADO";
  if (previous === "CONTESTADO") return next === "CONTESTADO" || next === "ESTORNADO";
  if (previous === "ESTORNADO_PARCIAL") return ["ESTORNADO_PARCIAL", "ESTORNADO", "CONTESTADO"].includes(next);
  if (previous === "APROVADO") return hasPaid(next);
  if (previous === "RECUSADO" || previous === "CANCELADO") return next !== "PENDENTE";
  return true;
}

/** Tentativas antigas recusadas não podem apagar um pagamento confirmado. */
export function aggregateStatus(statuses: (PaymentStatus | null)[], fallback: PaymentStatus): PaymentStatus {
  for (const state of ["CONTESTADO", "APROVADO", "ESTORNADO_PARCIAL", "ESTORNADO"] as const) {
    if (statuses.includes(state)) return state;
  }
  return hasPaid(fallback) ? fallback : statuses.at(-1) ?? fallback;
}
