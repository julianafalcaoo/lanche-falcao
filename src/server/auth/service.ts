import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";
import { normalizarTelefoneBrasileiro } from "../../lib/telefone.ts";
import { solicitarOtp, verificarOtp, OtpError } from "../infobip/otp.ts";
import { newToken, tokenHash, SESSION_SECONDS } from "./session.ts";

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function solicitarDesafio(nome: unknown, value: unknown) {
  if (typeof nome !== "string" || !nome.trim() || nome.trim().length > 100 || /[\x00-\x1f\x7f]/.test(nome)) {
    throw new AuthError("NOME_INVALIDO", 422, "Informe um nome entre 1 e 100 caracteres.");
  }
  const telefone = normalizarTelefoneBrasileiro(value);
  if (!telefone) throw new OtpError("TELEFONE_INVALIDO");
  const expiraEm = new Date(Date.now() + 5 * 60 * 1000);
  const { pinId } = await solicitarOtp(telefone);
  const desafioId = randomBytes(32).toString("hex");
  await prisma.desafioOtp.create({ data: { id: desafioId, nome: nome.trim(), telefone, pinId, expiraEm } });
  return { enviado: true, desafioId };
}

export async function verificarDesafio(id: unknown, codigo: unknown, previousToken: string | null) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) {
    throw new AuthError("DESAFIO_INVALIDO", 400, "Informe um desafio válido.");
  }
  if (typeof codigo !== "string" || !/^[0-9]{4}$/.test(codigo)) throw new OtpError("CODIGO_INVALIDO");
  const claimed = await prisma.desafioOtp.updateMany({
    where: { id, estado: "PENDENTE", expiraEm: { gt: new Date() } }, data: { estado: "PROCESSANDO" },
  });
  if (claimed.count !== 1) {
    const existing = await prisma.desafioOtp.findUnique({ where: { id }, select: { expiraEm: true } });
    if (!existing) throw new AuthError("DESAFIO_INVALIDO", 404, "Desafio não encontrado.");
    if (existing.expiraEm <= new Date()) throw new AuthError("DESAFIO_EXPIRADO", 410, "Desafio expirado. Solicite um novo código.");
    throw new AuthError("DESAFIO_INDISPONIVEL", 409, "Desafio já utilizado ou indisponível para verificação.");
  }
  const desafio = await prisma.desafioOtp.findUniqueOrThrow({ where: { id } });
  try {
    await verificarOtp(desafio.pinId, codigo);
  } catch (error) {
    const retryable = error instanceof OtpError && ["CODIGO_INCORRETO", "LIMITE_EXCEDIDO"].includes(error.code);
    await prisma.desafioOtp.updateMany({ where: { id, estado: "PROCESSANDO" }, data: { estado: retryable ? "PENDENTE" : "INVALIDADO" } });
    throw error;
  }
  const token = newToken();
  const expiraEm = new Date(Date.now() + SESSION_SECONDS * 1000);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.desafioOtp.updateMany({
      where: { id, estado: "PROCESSANDO", expiraEm: { gt: new Date() } },
      data: { estado: "CONSUMIDO", consumidoEm: new Date() },
    });
    if (consumed.count !== 1) throw new AuthError("DESAFIO_EXPIRADO", 410, "Desafio indisponível. Solicite um novo código.");
    const cliente = await tx.cliente.upsert({
      where: { telefone: desafio.telefone },
      create: { nome: desafio.nome, telefone: desafio.telefone, telefoneVerificado: true },
      update: { telefoneVerificado: true },
    });
    if (previousToken) await tx.sessao.deleteMany({ where: { tokenHash: tokenHash(previousToken) } });
    await tx.sessao.create({ data: { clienteId: cliente.id, tokenHash: tokenHash(token), expiraEm } });
  });
  return { token, expiraEm };
}
