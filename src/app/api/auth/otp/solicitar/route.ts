import { solicitarDesafio } from "../../../../../server/auth/service.ts";
import { protectMutation, authFailure } from "../../../../../server/auth/http.ts";
import { otpBody, otpJson } from "../../../../../server/infobip/http.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await otpBody(request);
    return otpJson(await solicitarDesafio(body.nome, body.telefone));
  } catch (error) {
    return authFailure(error);
  }
}
