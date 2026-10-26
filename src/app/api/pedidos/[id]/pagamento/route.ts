import { requireCliente } from "../../../../../server/pedidos/session.ts";
import { protectMutation } from "../../../../../server/auth/http.ts";
import { pedidoBody, pedidoFailure, pedidoJson } from "../../../../../server/pedidos/http.ts";
import { parseKey } from "../../../../../server/pedidos/validation.ts";
import { paymentView, processPayment } from "../../../../../server/mercado-pago/service.ts";
import { record } from "../../../../../server/mercado-pago/validation.ts";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { return pedidoJson(await paymentView(await requireCliente(request), (await context.params).id)); }
  catch (error) { return pedidoFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const clienteId = await requireCliente(request);
    protectMutation(request);
    const body = await pedidoBody(request);
    const consult = record(body) && Object.keys(body).length === 1 && body.consultar === true;
    return pedidoJson(await processPayment(clienteId, (await context.params).id, consult ? undefined : body, consult ? undefined : parseKey(request.headers.get("Idempotency-Key"))));
  } catch (error) { return pedidoFailure(error); }
}
