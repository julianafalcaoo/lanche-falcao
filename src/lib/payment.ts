export type FormaPagamento = "PIX" | "DINHEIRO" | "CARTAO";
export interface PaymentDraft {
  formaPagamento: FormaPagamento | null;
  precisaTroco: boolean;
  trocoValor: string;
}
export type PaymentSelection =
  | { formaPagamento: "PIX" | "CARTAO" }
  | { formaPagamento: "DINHEIRO"; precisaTroco: boolean; trocoParaCentavos: number | null };
export const emptyPayment: PaymentDraft = { formaPagamento: null, precisaTroco: false, trocoValor: "" };

// Decimal brasileiro convertido por partes inteiras, sem multiplicar um float monetário.
export function reaisToCentavos(value: string): number | null {
  const match = /^(\d{1,8}|\d{1,3}(?:\.\d{3}){1,2})(?:,(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1].replaceAll(".", "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2147483647 ? cents : null;
}

export function restorePayment(value: Record<string, unknown>): PaymentDraft {
  const { formaPagamento, precisaTroco, trocoValor } = value;
  if (formaPagamento === "PIX" || formaPagamento === "CARTAO") return { formaPagamento, precisaTroco: false, trocoValor: "" };
  if (formaPagamento !== "DINHEIRO" || typeof precisaTroco !== "boolean") return { ...emptyPayment };
  return { formaPagamento, precisaTroco, trocoValor: precisaTroco && typeof trocoValor === "string" && reaisToCentavos(trocoValor) !== null ? trocoValor : "" };
}

export function paymentError(payment: PaymentDraft, totalCentavos: number): string {
  if (!payment.formaPagamento) return "Escolha uma forma de pagamento para continuar.";
  if (payment.formaPagamento === "DINHEIRO" && payment.precisaTroco) {
    const cents = reaisToCentavos(payment.trocoValor);
    if (cents === null) return "Informe um valor válido e maior que zero para troco, em reais.";
    if (cents < totalCentavos) return "O valor para troco deve ser maior ou igual ao total do pedido.";
  }
  return "";
}
