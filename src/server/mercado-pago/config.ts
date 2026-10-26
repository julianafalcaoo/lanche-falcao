import "server-only";
import { PedidoError } from "../pedidos/validation.ts";

export function paymentConfig() {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  const publicKey = process.env.MERCADO_PAGO_PUBLIC_KEY?.trim();
  if (!accessToken || !publicKey || (process.env.MERCADO_PAGO_AMBIENTE?.trim() || "test") !== "test") {
    throw new PedidoError("PAGAMENTO_CONFIGURACAO", 503, "Pagamento indisponível. Tente novamente em instantes.");
  }
  return { accessToken, publicKey };
}
