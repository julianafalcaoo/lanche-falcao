import { logout, sessionCookie } from "../../../../server/auth/session.ts";
import { protectMutation, authFailure } from "../../../../server/auth/http.ts";
import { otpJson } from "../../../../server/infobip/http.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    await logout(request);
    const response = otpJson({ autenticado: false });
    response.headers.set("Set-Cookie", sessionCookie("", new Date(0), true));
    return response;
  } catch (error) { return authFailure(error); }
}
