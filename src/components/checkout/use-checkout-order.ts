"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import type { CheckoutOrder } from "@/types/checkout-payment";
import { checkoutRequest, CheckoutRequestError, validOrder } from "./payment-api";
import { checkoutIntent } from "@/lib/checkout-intent";

const storageKey = "lanche-falcao:order-flow";
export interface OrderRequest { key: string; body: Record<string, unknown>; pedidoId?: string }
export function useCheckoutOrder(intent: string | null) {
  const [savedRequest, setRequest] = useReducer((_: OrderRequest | null, value: OrderRequest | null) => value, null);
  const request = intent && savedRequest && checkoutIntent(savedRequest.body) === intent ? savedRequest : null;
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [ready, setReady] = useReducer((_: boolean, value: boolean) => value, false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (intent && savedRequest && checkoutIntent(savedRequest.body) !== intent) {
      sessionStorage.removeItem(storageKey);
      setRequest(null);
    }
  }, [intent, savedRequest]);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved.key === "string" && /^[a-f0-9-]{36}$/i.test(saved.key) && saved.body && typeof saved.body === "object" && !Array.isArray(saved.body) && (saved.pedidoId === undefined || (typeof saved.pedidoId === "string" && /^[a-f0-9-]{36}$/i.test(saved.pedidoId)))) setRequest({ key: saved.key, body: saved.body, pedidoId: saved.pedidoId });
    } catch { /* Corrupt local data is never trusted by the API. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!request?.pedidoId) return;
    let active = true;
    void checkoutRequest<{ pedido: CheckoutOrder }>(`/api/pedidos/${request.pedidoId}`).then(result => {
      if (!validOrder(result.pedido)) throw new Error("Resposta de pedido inválida.");
      if (active) setOrder(result.pedido);
    }).catch(() => { if (active) setError("Não foi possível recuperar o pedido. Confirme sua identificação e tente novamente."); });
    return () => { active = false; };
  }, [request?.pedidoId]);
  async function start(body?: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setCanEdit(false);
    const startedIntent = intent;
    try {
      const pending = request ?? { key: crypto.randomUUID(), body: body! };
      if (!pending.body) throw new Error("Confira os dados do pedido.");
      if (checkoutIntent(pending.body) !== startedIntent) throw new Error("Confira os dados do pedido.");
      // Salva ANTES da rede; sem storage, não arriscar perder a chave em um reload.
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
      setRequest(pending);
      const result = pending.pedidoId
        ? await checkoutRequest<{ pedido: CheckoutOrder }>(`/api/pedidos/${pending.pedidoId}`)
        : await checkoutRequest<{ pedido: CheckoutOrder }>("/api/pedidos", pending.body, pending.key);
      if (!validOrder(result.pedido)) throw new Error("Resposta de pedido inválida. Tente recuperar novamente.");
      // A resposta de uma compra abandonada não pode substituir a compra atual.
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (stored?.key !== pending.key) return;
      sessionStorage.setItem(storageKey, JSON.stringify({ ...pending, pedidoId: result.pedido.id }));
      setRequest({ ...pending, pedidoId: result.pedido.id }); setOrder(result.pedido);
    } catch (failure) {
      setCanEdit(!request?.pedidoId && failure instanceof CheckoutRequestError && [400, 422].includes(failure.status));
      setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "A resposta demorou. Tente novamente para recuperar o mesmo pedido.");
    }
    finally { lock.current = false; setBusy(false); }
  }
  function finish() { sessionStorage.removeItem(storageKey); setRequest(null); setOrder(null); setError(""); }
  return { request, order: request?.pedidoId === order?.id ? order : null, ready, busy, error, canEdit, start, finish };
}
