import "server-only";
import { normalizarTelefoneBrasileiro } from "../../lib/telefone.ts";
import { OtpError } from "../infobip/otp.ts";

/** Homologação hospedada: SMS somente para testadores autorizados, nunca público por omissão. */
export function assertOtpAccess(telefone: string) {
  const configured = process.env.INFOBIP_ALLOWED_PHONES?.trim();
  if (!configured && process.env.VERCEL !== "1") return;
  const values = configured?.split(",").map(value => normalizarTelefoneBrasileiro(value.trim()));
  if (!values?.length || values.some(value => !value)) throw new OtpError("CONFIGURACAO_OTP_INVALIDA");
  if (!values.includes(telefone as NonNullable<ReturnType<typeof normalizarTelefoneBrasileiro>>)) throw new OtpError("TELEFONE_NAO_PERMITIDO");
}
