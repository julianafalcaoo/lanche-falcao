import { requireCliente } from "../../../../server/pedidos/session.ts";
import { pedidoFailure, pedidoJson } from "../../../../server/pedidos/http.ts";
import { paymentConfig } from "../../../../server/mercado-pago/config.ts";
import { sandboxCardEmail } from "../../../../server/mercado-pago/sandbox.ts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { await requireCliente(request); return pedidoJson({ publicKey: paymentConfig().publicKey, ambiente: "test", payerEmail: sandboxCardEmail() }); }
  catch (error) { return pedidoFailure(error); }
}
