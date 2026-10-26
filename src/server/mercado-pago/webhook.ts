import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";
import { pedidoFailure, pedidoJson } from "../pedidos/http.ts";
import { PedidoError } from "../pedidos/validation.ts";
import { paymentConfig } from "./config.ts";
import { ProviderError } from "./client.ts";
import { record } from "./validation.ts";
import { verifyOrderSignature } from "./webhook-signature.ts";
import { reconcileOrder } from "./reconciliation.ts";

async function boundedBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new PedidoError("CONTEUDO_INVALIDO", 415, "Utilize application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new PedidoError("JSON_INVALIDO", 400, "Notificação inválida.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new PedidoError("CORPO_EXCEDIDO", 413, "Notificação muito grande."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof PedidoError) throw error;
    throw new PedidoError("JSON_INVALIDO", 400, "Notificação inválida.");
  } finally { reader.releaseLock(); }
}

export async function receiveOrderWebhook(request: Request, schedule: (work: () => Promise<void>) => void) {
  try {
    paymentConfig(); // Produção continua bloqueada.
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim();
    if (!secret) throw new PedidoError("WEBHOOK_CONFIGURACAO", 503, "Notificações indisponíveis.");
    const signed = verifyOrderSignature(request, secret);
    const query = new URL(request.url).searchParams;
    const body = await boundedBody(request);
    if (query.getAll("type").length !== 1 || query.get("type") !== "order" || !record(body) || body.type !== "order" ||
        !record(body.data) || body.data.id !== signed.orderId || (body.api_version !== undefined && body.api_version !== "v1")) {
      throw new PedidoError("EVENTO_INVALIDO", 400, "Notificação de Order inválida.");
    }
    // O corpo não é assinado integralmente: status, action, data.version e ID do evento NÃO comandam a escrita.
    await prisma.webhookOrder.upsert({ where: { id: signed.receiptId }, create: { id: signed.receiptId, orderId: signed.orderId }, update: {} });
    schedule(async () => { await processOrderWebhook(signed.receiptId); });
    return pedidoJson({ recebido: true }); // ACK somente depois da gravação durável.
  } catch (error) { return pedidoFailure(error); }
}

/** Reserva durável e recuperável; erro após ACK permanece na fila. */
export async function processOrderWebhook(id: string) {
  const now = new Date(), token = randomUUID();
  const claim = await prisma.webhookOrder.updateMany({
    where: { id, processadoEm: null, proximaExecucaoEm: { lte: now }, OR: [{ reservadaAte: null }, { reservadaAte: { lte: now } }] },
    data: { reservaToken: token, reservadaAte: new Date(Date.now() + 90000), tentativas: { increment: 1 } },
  });
  if (!claim.count) return;
  const event = await prisma.webhookOrder.findUniqueOrThrow({ where: { id } });
  try {
    await reconcileOrder(event.orderId);
    await prisma.webhookOrder.updateMany({ where: { id, reservaToken: token }, data: { processadoEm: new Date(), reservadaAte: null, reservaToken: null, codigoErro: null } });
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError("RECONCILIACAO_INDISPONIVEL");
    const delay = Math.max(failure.waitSeconds, Math.min(3600, 5 * 2 ** Math.min(event.tentativas, 10)));
    await prisma.webhookOrder.updateMany({ where: { id, reservaToken: token }, data: { codigoErro: failure.code, proximaExecucaoEm: new Date(Date.now() + delay * 1000), reservadaAte: null, reservaToken: null } });
  }
}
