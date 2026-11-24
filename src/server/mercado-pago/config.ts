import "server-only";
import { PedidoError } from "../pedidos/validation.ts";

export function paymentEnvironment(): "test" | "production" {
  const environment = process.env.MERCADO_PAGO_AMBIENTE?.trim();
  if (environment !== "test" && environment !== "production") {
    throw new PedidoError("PAGAMENTO_CONFIGURACAO", 503, "Ambiente de pagamento indisponível.");
  }
  return environment;
}

export function paymentConfig() {
  const environment = paymentEnvironment();
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  const publicKey = process.env.MERCADO_PAGO_PUBLIC_KEY?.trim();
  // APP_USR também pode identificar credenciais de teste de Orders: prefixo não prova ambiente.
  // Em produção rejeitamos formatos de teste conhecidos e pares obviamente inválidos.
  if (!accessToken || !publicKey || /\s/.test(accessToken + publicKey) || accessToken === publicKey ||
      (environment === "production" && (!/^APP_USR-[A-Za-z0-9-]{20,}$/.test(accessToken) || !/^APP_USR-[A-Za-z0-9-]{20,}$/.test(publicKey)))) {
    throw new PedidoError("PAGAMENTO_CONFIGURACAO", 503, "Pagamento indisponível. Tente novamente em instantes.");
  }
  return { accessToken, publicKey, environment };
}
