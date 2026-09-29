import "server-only";
import { isObject, OtpError } from "./otp.ts";

export function otpJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function otpBody(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { throw new OtpError("JSON_INVALIDO"); }
  if (!isObject(body)) throw new OtpError("JSON_INVALIDO");
  return body;
}

export function otpFailure(error: unknown) {
  const safe = error instanceof OtpError ? error : new OtpError("PROVEDOR_INDISPONIVEL");
  return otpJson({ erro: safe.code, mensagem: safe.message }, safe.status);
}
