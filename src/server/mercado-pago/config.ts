import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
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
  const approvedPair = process.env.MERCADO_PAGO_CREDENTIAL_PAIR_SHA256?.trim() ?? "";
  const productionDeployment = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
  const pair = createHash("sha256").update(JSON.stringify([environment, accessToken, publicKey])).digest();
  if ((environment === "production") !== productionDeployment ||
      !/^[a-f0-9]{64}$/i.test(approvedPair) || !timingSafeEqual(pair, Buffer.from(approvedPair, "hex"))) {
    throw new PedidoError("PAGAMENTO_CONFIGURACAO", 503, "Pagamento indisponível. Tente novamente em instantes.");
  }
  return { accessToken, publicKey, environment };
}

export function paymentCreationConfig() {
  const config = paymentConfig();
  if (config.environment === "production" &&
      (process.env.MERCADO_PAGO_PRODUCTION_CHARGES_ENABLED !== "true" ||
       !process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim() ||
       (process.env.CRON_SECRET?.trim().length ?? 0) < 16)) {
    throw new PedidoError("PAGAMENTO_CONFIGURACAO", 503, "Pagamento online indisponível. Consulte um pagamento já iniciado ou tente mais tarde.");
  }
  return config;
}
