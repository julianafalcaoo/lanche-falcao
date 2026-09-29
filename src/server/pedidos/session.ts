import "server-only";
import { prisma } from "../../lib/prisma.ts";
import { readSessionToken, tokenHash } from "../auth/session.ts";
import { PedidoError } from "./validation.ts";

export async function requireCliente(request: Request) {
  const token = readSessionToken(request);
  const session = token ? await prisma.sessao.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { expiraEm: true, cliente: { select: { id: true, telefoneVerificado: true } } },
  }) : null;
  if (!session || session.expiraEm <= new Date() || !session.cliente.telefoneVerificado) {
    throw new PedidoError("NAO_AUTENTICADO", 401, "Identifique-se para acessar seus pedidos.");
  }
  return session.cliente.id;
}
