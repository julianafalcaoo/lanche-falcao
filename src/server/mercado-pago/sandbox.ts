import "server-only";
import { paymentConfig } from "./config.ts";
import { PedidoError } from "../pedidos/validation.ts";

function assertSandbox() {
  if (paymentConfig().environment !== "test") throw new PedidoError("PAGADOR_OBRIGATORIO", 422, "Informe os dados reais do comprador.");
}

/** Official Orders PIX fixture, never commercial Cliente data.
 * Production must supply a real payer via a separate validated customer flow.
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix
 */
export function sandboxPixInput() {
  assertSandbox();
  return { payer: { email: "test_user_br@testuser.com", first_name: "APRO" } };
}

export function sandboxCardEmail() {
  assertSandbox();
  // Official Orders card test email; not read from or written to Cliente.
  return "test@testuser.com";
}
