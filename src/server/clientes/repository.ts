import "server-only";
import { prisma } from "../../lib/prisma.ts";
import type { TelefoneBrasileiro } from "../../lib/telefone.ts";

export function buscarClientePorTelefone(telefone: TelefoneBrasileiro) {
  return prisma.cliente.findUnique({
    where: { telefone },
    select: { id: true },
  });
}
