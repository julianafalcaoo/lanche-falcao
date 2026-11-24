import { requireCliente } from "../../../../server/pedidos/session.ts";
import { alterarPagamento, consultarPedido } from "../../../../server/pedidos/service.ts";
import { pedidoBody, pedidoFailure, pedidoJson } from "../../../../server/pedidos/http.ts";
import { protectMutation } from "../../../../server/auth/http.ts";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const clienteId = await requireCliente(request);
    const { id } = await context.params;
    return pedidoJson({ pedido: await consultarPedido(clienteId, id) });
  } catch (error) { return pedidoFailure(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const clienteId = await requireCliente(request);
    protectMutation(request);
    const { id } = await context.params;
    return pedidoJson({ pedido: await alterarPagamento(clienteId, id, await pedidoBody(request)) });
  } catch (error) { return pedidoFailure(error); }
}
