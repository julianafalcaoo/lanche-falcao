import { createHash, timingSafeEqual } from "node:crypto";
import { reconciliationBatch } from "../../../../../server/mercado-pago/worker.ts";
import { pedidoJson } from "../../../../../server/pedidos/http.ts";

export const runtime = "nodejs";
export const maxDuration = 120;

async function run(request: Request, secret: string | undefined) {
  if (!secret) return pedidoJson({ erro: "RECONCILIACAO_CONFIGURACAO" }, 503);
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) return pedidoJson({ erro: "NAO_AUTORIZADO" }, 401);
  try { return pedidoJson(await reconciliationBatch()); }
  catch { return pedidoJson({ erro: "RECONCILIACAO_INDISPONIVEL" }, 503); }
}

// Agendadores externos existentes continuam usando POST e seu segredo independente.
export async function POST(request: Request) {
  return run(request, process.env.MERCADO_PAGO_RECONCILIACAO_SECRET?.trim());
}

// Vercel Cron envia GET com Authorization: Bearer <CRON_SECRET>.
export async function GET(request: Request) {
  return run(request, process.env.CRON_SECRET?.trim());
}
