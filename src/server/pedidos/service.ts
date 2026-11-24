import "server-only";
import { createHash } from "node:crypto";
import { products } from "../../data/menu.ts";
import { prisma } from "../../lib/prisma.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { PedidoError, isUuid, parsePaymentSelection, parsePedido } from "./validation.ts";
import { canPrepare } from "../mercado-pago/states.ts";
import { DELIVERY_FEE_CENTS } from "./delivery.ts";

const select = {
  id: true, tipo: true, status: true, subtotalCentavos: true, taxaEntregaCentavos: true, totalCentavos: true,
  formaPagamento: true, statusPagamento: true, precisaTroco: true, trocoParaCentavos: true,
  criadoEm: true, atualizadoEm: true,
  entregaCep: true, entregaRua: true, entregaNumero: true, entregaBairro: true,
  entregaCidade: true, entregaUf: true, entregaComplemento: true, entregaReferencia: true,
  itens: { orderBy: { produtoId: "asc" }, select: {
    produtoId: true, nomeProduto: true, precoUnitarioCentavos: true, quantidade: true, subtotalCentavos: true,
  } },
} satisfies Prisma.PedidoSelect;
type StoredPedido = Prisma.PedidoGetPayload<{ select: typeof select }>;
function publicPedido(pedido: StoredPedido) {
  return {
    id: pedido.id, tipo: pedido.tipo, status: pedido.status,
    formaPagamento: pedido.formaPagamento, statusPagamento: pedido.statusPagamento,
    liberadoParaPreparo: canPrepare(pedido.formaPagamento, pedido.statusPagamento),
    precisaTroco: pedido.precisaTroco, trocoParaCentavos: pedido.trocoParaCentavos,
    subtotalCentavos: pedido.subtotalCentavos, taxaEntregaCentavos: pedido.taxaEntregaCentavos, totalCentavos: pedido.totalCentavos,
    criadoEm: pedido.criadoEm, atualizadoEm: pedido.atualizadoEm, itens: pedido.itens,
    ...(pedido.tipo === "ENTREGA" ? { endereco: {
      postalCode: pedido.entregaCep, street: pedido.entregaRua, number: pedido.entregaNumero,
      neighborhood: pedido.entregaBairro, city: pedido.entregaCidade, state: pedido.entregaUf,
      complement: pedido.entregaComplemento ?? "", reference: pedido.entregaReferencia ?? "",
    } } : {}),
  };
}
function replay(existing: StoredPedido & { requisicaoHash: string }, hash: string) {
  if (existing.requisicaoHash !== hash) throw new PedidoError("IDEMPOTENCIA_CONFLITO", 409, "Esta chave já foi utilizada com outro conteúdo.");
  return { pedido: publicPedido(existing), created: false };
}

export async function criarPedido(clienteId: string, key: string, body: unknown) {
  const input = parsePedido(body);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const where = { clienteId_chaveIdempotencia: { clienteId, chaveIdempotencia: key } };
  const existing = await prisma.pedido.findUnique({ where, select: { ...select, requisicaoHash: true } });
  if (existing) return replay(existing, hash);
  const itens = input.itens.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product) throw new PedidoError("PRODUTO_INEXISTENTE", 422, "Um dos produtos não está disponível no cardápio.");
    const subtotal = product.priceInCents * item.quantity;
    if (!Number.isSafeInteger(product.priceInCents) || product.priceInCents <= 0 || !Number.isSafeInteger(subtotal) || subtotal > 2147483647) throw new PedidoError("VALOR_INVALIDO", 422, "Não foi possível calcular os valores deste pedido.");
    return { produtoId: product.id, nomeProduto: product.name, precoUnitarioCentavos: product.priceInCents, quantidade: item.quantity, subtotalCentavos: subtotal };
  });
  const subtotalCentavos = itens.reduce((sum, item) => sum + item.subtotalCentavos, 0);
  const taxaEntregaCentavos = input.tipo === "ENTREGA" ? DELIVERY_FEE_CENTS : 0;
  const totalCentavos = subtotalCentavos + taxaEntregaCentavos;
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos > 2147483647) throw new PedidoError("VALOR_INVALIDO", 422, "O valor do pedido excede o limite permitido.");
  const endereco = input.endereco;
  validateCash(input.trocoParaCentavos, totalCentavos);
  try {
    const pedido = await prisma.$transaction(async (tx) => tx.pedido.create({
      data: {
        clienteId, tipo: input.tipo, status: "PEDIDO_RECEBIDO", subtotalCentavos, taxaEntregaCentavos, totalCentavos,
        formaPagamento: input.formaPagamento, statusPagamento: "PENDENTE",
        precisaTroco: input.precisaTroco, trocoParaCentavos: input.trocoParaCentavos,
        chaveIdempotencia: key, requisicaoHash: hash,
        ...(endereco ? {
          entregaCep: endereco.postalCode, entregaRua: endereco.street, entregaNumero: endereco.number,
          entregaBairro: endereco.neighborhood, entregaCidade: endereco.city, entregaUf: endereco.state,
          entregaComplemento: endereco.complement || null, entregaReferencia: endereco.reference || null,
        } : {}),
        itens: { create: itens },
      }, select,
    }));
    return { pedido: publicPedido(pedido), created: true };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const winner = await prisma.pedido.findUnique({ where, select: { ...select, requisicaoHash: true } });
      if (winner) return replay(winner, hash);
    }
    throw error;
  }
}

function validateCash(changeFor: number | null, total: number) {
  if (changeFor !== null && changeFor < total) throw new PedidoError("TROCO_INSUFICIENTE", 422, "O valor para troco deve ser maior ou igual ao total do pedido.");
}

export async function alterarPagamento(clienteId: string, id: string, body: unknown) {
  if (!isUuid(id)) throw new PedidoError("PEDIDO_NAO_ENCONTRADO", 404, "Pedido não encontrado.");
  return prisma.$transaction(async tx => {
    // Compartilha o bloqueio usado na reserva de tentativas e na aplicação de snapshots.
    await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${id}::uuid AND "clienteId" = ${clienteId}::uuid FOR UPDATE`;
    const pedido = await tx.pedido.findFirst({ where: { id, clienteId }, select });
    if (!pedido) throw new PedidoError("PEDIDO_NAO_ENCONTRADO", 404, "Pedido não encontrado.");
    const payment = parsePaymentSelection(body);
    const attempt = await tx.tentativaPagamento.findFirst({ where: { pedidoId: id }, select: { id: true } });
    if (pedido.status !== "PEDIDO_RECEBIDO" || pedido.statusPagamento !== "PENDENTE" || attempt) {
      throw new PedidoError("TROCA_PAGAMENTO_BLOQUEADA", 409, "A forma de pagamento está bloqueada. Retome o pedido para consultar a situação.");
    }
    validateCash(payment.trocoParaCentavos, pedido.totalCentavos);
    if (pedido.formaPagamento === payment.formaPagamento && pedido.trocoParaCentavos === payment.trocoParaCentavos && pedido.precisaTroco === payment.precisaTroco) return publicPedido(pedido);
    return publicPedido(await tx.pedido.update({ where: { id }, data: payment, select }));
  });
}

export async function consultarPedido(clienteId: string, id: string) {
  if (!isUuid(id)) throw new PedidoError("PEDIDO_NAO_ENCONTRADO", 404, "Pedido não encontrado.");
  const pedido = await prisma.pedido.findFirst({ where: { id, clienteId }, select });
  if (!pedido) throw new PedidoError("PEDIDO_NAO_ENCONTRADO", 404, "Pedido não encontrado.");
  return publicPedido(pedido);
}

export async function listarPedidos(clienteId: string, limite: number, cursor: string | null) {
  const after = cursor ? await prisma.pedido.findFirst({ where: { id: cursor, clienteId }, select: { id: true, criadoEm: true } }) : null;
  if (cursor && !after) throw new PedidoError("CURSOR_INVALIDO", 400, "Cursor de paginação inválido.");
  const rows = await prisma.pedido.findMany({
    where: { clienteId, ...(after ? { OR: [{ criadoEm: { lt: after.criadoEm } }, { criadoEm: after.criadoEm, id: { lt: after.id } }] } : {}) },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: limite + 1, select,
  });
  const more = rows.length > limite;
  const pedidos = rows.slice(0, limite).map(publicPedido);
  return { pedidos, proximoCursor: more ? pedidos[pedidos.length - 1].id : null };
}
