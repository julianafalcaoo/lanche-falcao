import "server-only";
import { paymentConfig } from "./config.ts";

/** Official Orders PIX fixture, never commercial Cliente data.
 * Production must supply a real payer via a separate validated customer flow.
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix
 */
export function sandboxPixInput() {
  paymentConfig(); // Fails closed outside the explicitly supported test environment.
  return { payer: { email: "test_user_br@testuser.com", first_name: "APRO" } };
}

export function sandboxCardEmail() {
  paymentConfig();
  // Official Orders card test email; not read from or written to Cliente.
  return "test@testuser.com";
}
