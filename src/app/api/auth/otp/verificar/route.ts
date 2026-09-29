import { verificarDesafio } from "../../../../../server/auth/service.ts";
import { protectMutation, authFailure } from "../../../../../server/auth/http.ts";
import { readSessionToken, sessionCookie } from "../../../../../server/auth/session.ts";
import { otpBody, otpJson } from "../../../../../server/infobip/http.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await otpBody(request);
    const { token, expiraEm } = await verificarDesafio(body.desafioId, body.codigo, readSessionToken(request));
    const response = otpJson({ verificado: true, autenticado: true });
    response.headers.set("Set-Cookie", sessionCookie(token, expiraEm));
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
