import "server-only";
import { PedidoError } from "../pedidos/validation.ts";
import { paymentEnvironment } from "./config.ts";

export const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new PedidoError("PAGAMENTO_INVALIDO", 422, "Dados de pagamento não permitidos.");
}
export interface PaymentInput {
  payer: { email: string; identification?: { type: string; number: string }; first_name?: string };
  card?: { token: string; payment_method_id: string; payment_type_id: "credit_card" | "debit_card"; installments: number };
}
export function parsePayment(value: unknown, method: string): PaymentInput {
  const invalid = () => new PedidoError("PAGAMENTO_INVALIDO", 422, "Confira os dados do pagamento.");
  if (!record(value)) throw invalid();
  keys(value, ["payer", "card"]);
  if (!record(value.payer)) throw invalid();
  keys(value.payer, ["email", "identification", "first_name"]);
  const email = value.payer.email;
  const production = paymentEnvironment() === "production";
  if (typeof email !== "string" || email.length > 254 ||
      (production ? !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email) || /@(testuser\.com|example\.(com|org|net))$/i.test(email) : !/^[a-zA-Z0-9._+-]+@testuser\.com$/.test(email))) {
    throw new PedidoError(production ? "EMAIL_COMPRADOR" : "EMAIL_TESTE", 422, "Informe um e-mail válido do comprador para o pagamento.");
  }
  const payer: PaymentInput["payer"] = { email };
  if (value.payer.identification !== undefined) {
    const doc = value.payer.identification;
    if (!record(doc)) throw invalid();
    keys(doc, ["type", "number"]);
    if (doc.type !== "CPF" || typeof doc.number !== "string" || !/^\d{11}$/.test(doc.number)) throw invalid();
    payer.identification = { type: doc.type, number: doc.number };
  }
  if (value.payer.first_name !== undefined) {
    if (production || method !== "PIX" || value.payer.first_name !== "APRO") throw invalid();
    payer.first_name = "APRO";
  }
  if (method === "PIX") {
    if ("card" in value) throw invalid();
    return { payer };
  }
  const card = value.card;
  if (method !== "CARTAO" || !record(card)) throw invalid();
  keys(card, ["token", "payment_method_id", "payment_type_id", "installments"]);
  if (typeof card.token !== "string" || !/^[a-zA-Z0-9_-]{16,256}$/.test(card.token) || typeof card.payment_method_id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(card.payment_method_id) || !["credit_card", "debit_card"].includes(String(card.payment_type_id)) || typeof card.installments !== "number" || !Number.isInteger(card.installments) || card.installments < 1 || card.installments > 12) throw invalid();
  return { payer, card: { token: card.token, payment_method_id: card.payment_method_id, payment_type_id: card.payment_type_id as "credit_card" | "debit_card", installments: card.installments } };
}
