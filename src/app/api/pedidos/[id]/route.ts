import { requireCliente } from "../../../../server/pedidos/session.ts";
import { consultarPedido } from "../../../../server/pedidos/service.ts";
import { pedidoFailure, pedidoJson } from "../../../../server/pedidos/http.ts";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const clienteId = await requireCliente(request);
    const { id } = await context.params;
    return pedidoJson({ pedido: await consultarPedido(clienteId, id) });
  } catch (error) { return pedidoFailure(error); }
}
