import "server-only";
import { createHash } from "node:crypto";
import { products } from "../../data/menu.ts";
import { prisma } from "../../lib/prisma.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { PedidoError, isUuid, parsePedido } from "./validation.ts";

const select = {
  id: true, tipo: true, status: true, subtotalCentavos: true, totalCentavos: true,
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
    subtotalCentavos: pedido.subtotalCentavos, totalCentavos: pedido.totalCentavos,
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
  if (!Number.isSafeInteger(subtotalCentavos) || subtotalCentavos > 2147483647) throw new PedidoError("VALOR_INVALIDO", 422, "O valor do pedido excede o limite permitido.");
  const endereco = input.endereco;
  try {
    const pedido = await prisma.$transaction(async (tx) => tx.pedido.create({
      data: {
        clienteId, tipo: input.tipo, status: "PEDIDO_RECEBIDO", subtotalCentavos, totalCentavos: subtotalCentavos,
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
