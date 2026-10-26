import "server-only";
import { AuthError } from "./service.ts";
import { otpFailure, otpJson } from "../infobip/http.ts";
import { OtpError } from "../infobip/otp.ts";
import { OtpRateLimitError } from "./otp-rate-limit.ts";

export function protectMutation(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin ||
      ![null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site"))) {
    throw new AuthError("ORIGEM_INVALIDA", 403, "Origem da solicitação não permitida.");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AuthError("CONTEUDO_INVALIDO", 415, "Utilize application/json.");
  }
}

export function authFailure(error: unknown) {
  if (error instanceof OtpRateLimitError) {
    const response = otpJson({ erro: error.status === 429 ? "LIMITE_EXCEDIDO" : "SERVICO_INDISPONIVEL", mensagem: error.message }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  if (error instanceof AuthError) return otpJson({ erro: error.code, mensagem: error.message }, error.status);
  if (error instanceof OtpError) return otpFailure(error);
  return otpJson({ erro: "SERVICO_INDISPONIVEL", mensagem: "Não foi possível continuar agora. Tente novamente mais tarde." }, 503);
}
