import { requireCliente } from "../../../../server/pedidos/session.ts";
import { pedidoFailure, pedidoJson } from "../../../../server/pedidos/http.ts";
import { paymentConfig } from "../../../../server/mercado-pago/config.ts";
import { sandboxCardEmail } from "../../../../server/mercado-pago/sandbox.ts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireCliente(request);
    const config = paymentConfig();
    return pedidoJson({ publicKey: config.publicKey, ambiente: config.environment, payerEmail: config.environment === "test" ? sandboxCardEmail() : null });
  }
  catch (error) { return pedidoFailure(error); }
}
