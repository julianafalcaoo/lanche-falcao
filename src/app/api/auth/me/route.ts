import { currentClient } from "../../../../server/auth/session.ts";
import { authFailure } from "../../../../server/auth/http.ts";
import { otpJson } from "../../../../server/infobip/http.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await currentClient(request);
    return session ? otpJson({ autenticado: true, ...session }) : otpJson({ autenticado: false }, 401);
  } catch (error) { return authFailure(error); }
}
