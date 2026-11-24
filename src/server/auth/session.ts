import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const sessionCookieName = () => process.env.NODE_ENV === "production" ? "__Host-lf_session" : "lf_session";
export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function readSessionToken(request: Request) {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${sessionCookieName()}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(sessionCookieName().length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function sessionCookie(token: string, expires: Date, clear = false) {
  return `${sessionCookieName()}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}; Expires=${expires.toUTCString()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function currentClient(request: Request) {
  const token = readSessionToken(request);
  if (!token) return null;
  const session = await prisma.sessao.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { expiraEm: true, cliente: { select: { nome: true, telefone: true, telefoneVerificado: true } } },
  });
  if (!session || session.expiraEm <= new Date() || !session.cliente.telefoneVerificado) return null;
  return { nome: session.cliente.nome, telefone: session.cliente.telefone };
}

export async function logout(request: Request) {
  const token = readSessionToken(request);
  if (token) await prisma.sessao.deleteMany({ where: { tokenHash: tokenHash(token) } });
}
