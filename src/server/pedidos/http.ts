import "server-only";
import { authFailure } from "../auth/http.ts";
import { PedidoError } from "./validation.ts";

export function pedidoJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
export function pedidoFailure(error: unknown) {
  if (error instanceof PedidoError) return pedidoJson({ erro: error.code, mensagem: error.message }, error.status);
  return authFailure(error);
}
export async function pedidoBody(request: Request) {
  try { return await request.json() as unknown; }
  catch { throw new PedidoError("JSON_INVALIDO", 400, "Envie um corpo JSON válido."); }
}
