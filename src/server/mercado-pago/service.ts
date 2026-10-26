import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";
import { PedidoError, isUuid } from "../pedidos/validation.ts";
import { paymentConfig } from "./config.ts";
import { mercadoPago, orderPayload, ProviderError } from "./client.ts";
import { applyOrderSnapshot, reconcileAttempt } from "./reconciliation.ts";
import { hasPaid } from "./states.ts";
import { parsePayment, record } from "./validation.ts";
import { sandboxPixInput } from "./sandbox.ts";

async function owned(clienteId: string, pedidoId: string) {
  if (!isUuid(pedidoId)) throw new PedidoError("PEDIDO_NAO_ENCONTRADO", 404, "Pedido não encontrado.");
  const pedido = await prisma.pedido.findFirst({ where: { id: pedidoId, clienteId } });
  if (!pedido) throw new PedidoError("PEDIDO_NAO_ENCONTRADO", 404, "Pedido não encontrado.");
  return pedido;
}
export async function paymentView(clienteId: string, pedidoId: string) {
  const pedido = await owned(clienteId, pedidoId);
  const attempt = await prisma.tentativaPagamento.findFirst({ where: { pedidoId }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }] });
  return { pedido: { id: pedido.id, formaPagamento: pedido.formaPagamento, statusPagamento: pedido.statusPagamento, totalCentavos: pedido.totalCentavos },
    tentativa: attempt ? { id: attempt.id, statusExterno: attempt.statusExterno, detalheExterno: attempt.detalheExterno, codigoErro: attempt.codigoErro,
      podeTentarNovamente: attempt.encerrada && !hasPaid(pedido.statusPagamento),
      aguardando: !attempt.encerrada, qrCode: attempt.qrCode, qrCodeBase64: attempt.qrCodeBase64, ticketUrl: attempt.ticketUrl } : null };
}

export async function processPayment(clienteId: string, pedidoId: string, body?: unknown, clientKey?: string) {
  const pedido = await owned(clienteId, pedidoId);
  if (pedido.formaPagamento === "DINHEIRO") return paymentView(clienteId, pedidoId);
  if (!pedido.formaPagamento) throw new PedidoError("PAGAMENTO_INVALIDO", 422, "Este pedido não possui forma de pagamento.");
  if (body === undefined) {
    const latest = await prisma.tentativaPagamento.findFirst({ where: { pedidoId }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }] });
    if (latest?.orderId) {
      try { await reconcileAttempt(latest.id); } catch (error) { if (!(error instanceof ProviderError)) throw error; }
      return paymentView(clienteId, pedidoId);
    }
  }
  if (hasPaid(pedido.statusPagamento)) return paymentView(clienteId, pedidoId);
  paymentConfig();
  const automaticPix = pedido.formaPagamento === "PIX" && record(body) && Object.keys(body).length === 1 && body.iniciarPix === true;
  const input = body === undefined ? null : parsePayment(automaticPix ? sandboxPixInput() : body, pedido.formaPagamento);
  const payload = input ? orderPayload(pedido, input) : null;
  const hash = payload ? createHash("sha256").update(JSON.stringify(payload)).digest("hex") : null;
  const lease = new Date(Date.now() + 60000);
  const attempt = await prisma.$transaction(async tx => {
    // Serializa reserva local, sem manter transação aberta durante a chamada externa.
    await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${pedidoId}::uuid FOR UPDATE`;
    const current = await tx.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
    if (hasPaid(current.statusPagamento)) return null;
    let selected = clientKey ? await tx.tentativaPagamento.findUnique({ where: { pedidoId_chaveCliente: { pedidoId, chaveCliente: clientKey } } }) : null;
    if (selected && hash && selected.requisicaoHash !== hash) throw new PedidoError("IDEMPOTENCIA_CONFLITO", 409, "Esta tentativa já foi usada com outros dados. Consulte a situação do pagamento.");
    if (!selected) {
      const active = await tx.tentativaPagamento.findFirst({ where: { pedidoId, encerrada: false } });
      if (active) selected = active;
      else if (payload && hash && clientKey) {
        const method = payload.transactions.payments[0].payment_method;
        selected = await tx.tentativaPagamento.create({ data: { pedidoId, chaveCliente: clientKey, chaveProvedor: randomUUID(), requisicaoHash: hash, statusLocal: "PENDENTE", metodoExterno: method.id, tipoMetodoExterno: method.type } });
        await tx.pedido.update({ where: { id: pedidoId }, data: { statusPagamento: "PENDENTE" } });
      } else selected = await tx.tentativaPagamento.findFirst({ where: { pedidoId }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }] });
    }
    if (!selected || selected.encerrada || (selected.bloqueadaAte && selected.bloqueadaAte > new Date())) return null;
    // Sem ID remoto, só repetir o MESMO payload/chave. Token não é persistido.
    if (!selected.orderId && payload && (selected.requisicaoHash !== hash || selected.chaveCliente !== clientKey || Date.now() - selected.criadoEm.getTime() > 86400000 || selected.codigoErro === "RECONCILIACAO_NECESSARIA")) return null;
    return tx.tentativaPagamento.update({ where: { id: selected.id }, data: { bloqueadaAte: lease, envios: { increment: 1 } } });
  });
  if (!attempt) return paymentView(clienteId, pedidoId);
  try {
    let raw: unknown;
    if (attempt.orderId) raw = await mercadoPago.get(attempt.orderId);
    else if (payload) raw = await mercadoPago.create(payload, attempt.chaveProvedor);
    else {
      // Recuperação de resposta perdida sem guardar token de cartão no banco/browser.
      const search = await mercadoPago.search(pedidoId, attempt.criadoEm);
      const known = await prisma.tentativaPagamento.findMany({ where: { pedidoId, orderId: { not: null } }, select: { orderId: true } });
      if (!record(search) || !Array.isArray(search.data) || search.data.length >= 20) throw new ProviderError("RECONCILIACAO_NECESSARIA");
      const candidates = search.data.filter(item => record(item) && item.external_reference === pedidoId && typeof item.id === "string" && /^ORD[a-zA-Z0-9]{10,60}$/.test(item.id) && !known.some(previous => previous.orderId === item.id));
      if (candidates.length !== 1) throw new ProviderError("RECONCILIACAO_NECESSARIA");
      raw = await mercadoPago.get(candidates[0].id);
    }
    await applyOrderSnapshot(attempt.id, lease, raw);
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError("RESPOSTA_INCERTA");
    // Erro de consulta nunca autoriza uma nova cobrança; a Order já existe.
    const definitive = failure.definitive && !attempt.orderId && payload !== null && attempt.envios === 1;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${pedidoId}::uuid FOR UPDATE`;
      const changed = await tx.tentativaPagamento.updateMany({ where: { id: attempt.id, bloqueadaAte: lease }, data: { codigoErro: failure.code, encerrada: definitive, ...(definitive ? { statusLocal: "RECUSADO" } : {}), bloqueadaAte: new Date(Date.now() + failure.waitSeconds * 1000) } });
      const current = await tx.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
      if (changed.count && definitive && !hasPaid(current.statusPagamento)) await tx.pedido.update({ where: { id: pedidoId }, data: { statusPagamento: "RECUSADO" } });
    });
  }
  return paymentView(clienteId, pedidoId);
}
