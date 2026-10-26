import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { prisma } from "../../lib/prisma.ts";

export class OtpRateLimitError extends Error {
  readonly status: number;
  readonly retryAfter: number;
  constructor(status: number, retryAfter = 60) {
    super(status === 429 ? "Limite de solicitações atingido. Aguarde antes de tentar novamente." : "Solicitação de SMS indisponível agora.");
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function otpClientIp(request?: Request) {
  // Somente o proxy Vercel é confiável. Fora dele, todos compartilham uma cota local.
  if (process.env.VERCEL !== "1") return "local";
  const ip = request?.headers.get("x-forwarded-for")?.trim();
  if (!ip || !isIP(ip)) throw new OtpRateLimitError(503);
  if (isIP(ip) === 4) return ip;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  // IPv4 mapeado em IPv6 deve compartilhar a identidade IPv4.
  if (canonical.startsWith("::ffff:")) {
    const parts = canonical.slice(7).split(":");
    if (parts.length === 2) {
      const value = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
      return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join(".");
    }
  }
  // Agregar IPv6 por /64 impede contornar a cota mudando apenas o endereço da interface.
  const [left, right = ""] = canonical.split("::");
  const a = left ? left.split(":") : [], b = right ? right.split(":") : [];
  return [...a, ...Array(8 - a.length - b.length).fill("0"), ...b].slice(0, 4)
    .map(part => parseInt(part, 16).toString(16)).join(":") + "::/64";
}

/** Sem rede dentro da transação; UPSERT condicional serializa reservas entre instâncias. */
export async function reserveOtpQuota(telefone: string, request?: Request) {
  const secret = process.env.OTP_RATE_LIMIT_SECRET?.trim();
  if (!secret || secret.length < 32) throw new OtpRateLimitError(503);
  const ip = otpClientIp(request);
  const policies = [
    ["global-minute", "global", 60, 10],
    ["global-day", "global", 86400, 100],
    ["ip-quarter", ip, 900, 5],
    ["ip-day", ip, 86400, 20],
    ["phone-minute", telefone, 60, 1],
    ["phone-day", telefone, 86400, 5],
  ] as const;
  try {
    await prisma.$transaction(async tx => {
      for (const [policy, identity, seconds, limit] of policies) {
        const key = createHmac("sha256", secret).update(`${policy}:${identity}`).digest("hex");
        const rows = await tx.$queryRaw<{ chave: string }[]>`
          INSERT INTO "LimiteOtp" ("chave", "quantidade", "expiraEm")
          VALUES (${key}, 1, clock_timestamp() + make_interval(secs => ${seconds}::int))
          ON CONFLICT ("chave") DO UPDATE SET
            "quantidade" = CASE WHEN "LimiteOtp"."expiraEm" <= clock_timestamp() THEN 1 ELSE "LimiteOtp"."quantidade" + 1 END,
            "expiraEm" = CASE WHEN "LimiteOtp"."expiraEm" <= clock_timestamp() THEN clock_timestamp() + make_interval(secs => ${seconds}::int) ELSE "LimiteOtp"."expiraEm" END
          WHERE "LimiteOtp"."expiraEm" <= clock_timestamp() OR "LimiteOtp"."quantidade" < ${limit}::int
          RETURNING "chave"`;
        if (rows.length !== 1) throw new OtpRateLimitError(429, seconds);
      }
    });
  } catch (error) {
    if (error instanceof OtpRateLimitError) throw error;
    // Banco indisponível, migration ausente ou contenção: nunca enviar sem reserva.
    throw new OtpRateLimitError(503);
  }
}
