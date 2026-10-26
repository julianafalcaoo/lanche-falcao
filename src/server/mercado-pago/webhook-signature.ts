import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PedidoError } from "../pedidos/validation.ts";

/** Manifesto do SDK oficial Node, com os valores recebidos (sem alterar caixa do ID). */
export function verifyOrderSignature(request: Request, secret: string, now = Date.now()) {
  const invalid = () => new PedidoError("ASSINATURA_INVALIDA", 401, "Notificação não autenticada.");
  const query = new URL(request.url).searchParams;
  const id = query.get("data.id");
  const requestId = request.headers.get("x-request-id");
  const signature = request.headers.get("x-signature");
  if (query.getAll("data.id").length !== 1 || !id || !/^ORD[a-zA-Z0-9]{10,60}$/.test(id) ||
      !requestId || !/^[a-zA-Z0-9_-]{1,200}$/.test(requestId) || !signature || signature.length > 500) throw invalid();
  const parts = new Map<string, string>();
  for (const part of signature.split(",")) {
    const match = /^\s*([a-z0-9]+)\s*=\s*([^\s,=]+)\s*$/i.exec(part);
    if (!match || parts.has(match[1].toLowerCase())) throw invalid();
    parts.set(match[1].toLowerCase(), match[2]);
  }
  const ts = parts.get("ts"), hash = parts.get("v1");
  if (!ts || !/^\d{10}(\d{3})?$/.test(ts) || !hash || !/^[a-f0-9]{64}$/i.test(hash)) throw invalid();
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) throw invalid();
  // O exemplo Orders usa milissegundos; o SDK usa segundos. O manifesto nunca é convertido.
  const signedAt = Number(ts) * (ts.length === 10 ? 1000 : 1);
  if (Math.abs(now - signedAt) > 300000) throw invalid();
  return { orderId: id, receiptId: createHash("sha256").update(manifest).digest("hex") };
}
