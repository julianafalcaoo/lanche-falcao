import { protectMutation } from "../../../server/auth/http.ts";
import { requireCliente } from "../../../server/pedidos/session.ts";
import { criarPedido, listarPedidos } from "../../../server/pedidos/service.ts";
import { parseKey, parsePage } from "../../../server/pedidos/validation.ts";
import { pedidoBody, pedidoFailure, pedidoJson } from "../../../server/pedidos/http.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const clienteId = await requireCliente(request);
    protectMutation(request);
    const key = parseKey(request.headers.get("Idempotency-Key"));
    const result = await criarPedido(clienteId, key, await pedidoBody(request));
    return pedidoJson({ pedido: result.pedido }, result.created ? 201 : 200);
  } catch (error) { return pedidoFailure(error); }
}

export async function GET(request: Request) {
  try {
    const clienteId = await requireCliente(request);
    const { limite, cursor } = parsePage(request.url);
    return pedidoJson(await listarPedidos(clienteId, limite, cursor));
  } catch (error) { return pedidoFailure(error); }
}
