import "server-only";
import { prisma } from "../../lib/prisma.ts";
import { processOrderWebhook } from "./webhook.ts";
import { reconcileAttempt } from "./reconciliation.ts";
import { processPayment } from "./service.ts";
import { paymentConfig } from "./config.ts";

/** Lote limitado. Nenhuma chamada a create: recuperação automática é exclusivamente de leitura. */
export async function reconciliationBatch() {
  paymentConfig();
  const now = new Date();
  // Recupera também respostas de criação perdidas, pelo caminho conservador de busca existente.
  const attempts = await prisma.tentativaPagamento.findMany({
    where: { AND: [
      { OR: [{ orderId: { not: null } }, { encerrada: false, envios: { gt: 0 } }] },
      { OR: [{ bloqueadaAte: null }, { bloqueadaAte: { lte: now } }] },
      { OR: [{ reconciliadaEm: null }, { reconciliadaEm: { lte: new Date(Date.now() - 60000) } }] },
    ] },
    // Duas recuperações (até 2 chamadas de 15s cada) + dois eventos (15s) < 120s.
    orderBy: [{ reconciliadaEm: { sort: "asc", nulls: "first" } }, { criadoEm: "asc" }, { id: "asc" }], take: 2,
  });
  for (const attempt of attempts) {
    try {
      if (attempt.orderId) await reconcileAttempt(attempt.id);
      else {
        const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: attempt.pedidoId } });
        await processPayment(pedido.clienteId, pedido.id); // Sem body: nunca cria uma cobrança.
      }
    } catch { /* Erros seguros ficam na tentativa; o próximo lote tentará de novo. */ }
    // Evita que uma tentativa incerta monopolize todos os lotes.
    await prisma.tentativaPagamento.updateMany({ where: { id: attempt.id }, data: { reconciliadaEm: new Date() } });
  }
  const events = await prisma.webhookOrder.findMany({
    where: { processadoEm: null, proximaExecucaoEm: { lte: now }, OR: [{ reservadaAte: null }, { reservadaAte: { lte: now } }] },
    orderBy: [{ proximaExecucaoEm: "asc" }, { id: "asc" }], take: 2,
  });
  for (const event of events) await processOrderWebhook(event.id);
  return { tentativasConsultadas: attempts.length, notificacoesSelecionadas: events.length };
}
