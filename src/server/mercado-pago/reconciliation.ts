import "server-only";
import { prisma } from "../../lib/prisma.ts";
import { mercadoPago, normalizeOrder, ProviderError } from "./client.ts";
import { acceptsTransition, aggregateStatus, hasPaid, type PaymentStatus } from "./states.ts";
import { paymentConfig } from "./config.ts";

/** Única aplicação de snapshots: criação, consulta manual e webhook usam este caminho. */
export async function applyOrderSnapshot(attemptId: string, lease: Date, raw: unknown) {
  return prisma.$transaction(async tx => {
    const reference = await tx.tentativaPagamento.findUniqueOrThrow({ where: { id: attemptId } });
    await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${reference.pedidoId}::uuid FOR UPDATE`;
    const attempt = await tx.tentativaPagamento.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.bloqueadaAte?.getTime() !== lease.getTime() || lease <= new Date()) throw new ProviderError("RESERVA_EXPIRADA");
    const pedido = await tx.pedido.findUniqueOrThrow({ where: { id: attempt.pedidoId } });
    const result = normalizeOrder(raw, pedido, attempt.orderId);
    if (("metodoExterno" in result && attempt.metodoExterno && attempt.metodoExterno !== result.metodoExterno) ||
        ("tipoMetodoExterno" in result && attempt.tipoMetodoExterno && attempt.tipoMetodoExterno !== result.tipoMetodoExterno)) throw new ProviderError("METODO_DIVERGENTE");
    if (attempt.atualizadaNoProvedor && !result.atualizadaNoProvedor) throw new ProviderError("REVISAO_AUSENTE");
    const oldRevision = attempt.atualizadaNoProvedor && result.atualizadaNoProvedor && result.atualizadaNoProvedor < attempt.atualizadaNoProvedor;
    const sameRevision = attempt.atualizadaNoProvedor && result.atualizadaNoProvedor === attempt.atualizadaNoProvedor;
    if (sameRevision && (attempt.statusExterno !== result.statusExterno || attempt.detalheExterno !== result.detalheExterno)) throw new ProviderError("REVISAO_DIVERGENTE");
    // Uma contestação pode ser resolvida a favor do vendedor. Exige revisão remota posterior.
    const resolvedDispute = attempt.statusLocal === "CONTESTADO" && result.localStatus === "APROVADO" &&
      attempt.atualizadaNoProvedor && result.atualizadaNoProvedor && result.atualizadaNoProvedor > attempt.atualizadaNoProvedor;
    // Uma tentativa antiga pode continuar recebendo eventos, mas não regredir de paga para pendente.
    if (oldRevision || (!acceptsTransition(attempt.statusLocal, result.localStatus) && !resolvedDispute)) {
      await tx.tentativaPagamento.update({ where: { id: attemptId }, data: { bloqueadaAte: null, reconciliadaEm: new Date(), codigoErro: "ESTADO_REGRESSIVO" } });
      return;
    }
    const { localStatus, ...data } = result;
    await tx.tentativaPagamento.update({ where: { id: attemptId }, data: { ...data, statusLocal: localStatus, bloqueadaAte: null, codigoErro: null, reconciliadaEm: new Date() } });
    const history = await tx.tentativaPagamento.findMany({ where: { pedidoId: pedido.id }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }], select: { statusLocal: true } });
    const statusPagamento = aggregateStatus(history.map(row => row.statusLocal), pedido.statusPagamento as PaymentStatus);
    // O índice de tentativa ativa e as chaves existentes permanecem intactos.
    // Um estado pós-pagamento, inclusive contestação, não libera nova cobrança.
    if (hasPaid(pedido.statusPagamento) && !hasPaid(statusPagamento)) throw new ProviderError("ESTADO_REGRESSIVO");
    await tx.pedido.update({ where: { id: pedido.id }, data: { statusPagamento } });
  });
}

/** Só consulta: nunca cria Order ou gira chave. Também consulta tentativas encerradas. */
export async function reconcileAttempt(attemptId: string) {
  paymentConfig();
  const lease = new Date(Date.now() + 60000);
  const attempt = await prisma.$transaction(async tx => {
    const reference = await tx.tentativaPagamento.findUniqueOrThrow({ where: { id: attemptId } });
    await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${reference.pedidoId}::uuid FOR UPDATE`;
    const current = await tx.tentativaPagamento.findUniqueOrThrow({ where: { id: attemptId } });
    if (!current.orderId) throw new ProviderError("ORDER_NAO_VINCULADA");
    if (current.bloqueadaAte && current.bloqueadaAte > new Date()) throw new ProviderError("RECONCILIACAO_OCUPADA", false, 60);
    return tx.tentativaPagamento.update({ where: { id: attemptId }, data: { bloqueadaAte: lease } });
  });
  try {
    await applyOrderSnapshot(attemptId, lease, await mercadoPago.get(attempt.orderId!));
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError("RESPOSTA_INCERTA");
    await prisma.tentativaPagamento.updateMany({ where: { id: attemptId, bloqueadaAte: lease }, data: { codigoErro: failure.code, bloqueadaAte: new Date(Date.now() + failure.waitSeconds * 1000), reconciliadaEm: new Date() } });
    throw failure;
  }
}

export async function reconcileOrder(orderId: string) {
  const attempt = await prisma.tentativaPagamento.findUnique({ where: { orderId } });
  // Referência externa sozinha não prova a qual tentativa pertence uma Order desconhecida.
  if (!attempt) throw new ProviderError("ORDER_NAO_VINCULADA", false, 60);
  await reconcileAttempt(attempt.id);
}
