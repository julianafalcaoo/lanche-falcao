"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { PaymentSelection } from "@/lib/payment";
import type { CheckoutOrder } from "@/types/checkout-payment";
import { checkoutRequest, CheckoutRequestError, validOrder } from "./payment-api";

const storageKey = "lanche-falcao:order-flow";
const uuid = /^[a-f0-9-]{36}$/i;
type OrderRequest = { key: string; body: Record<string, unknown>; owner: string | null } | { pedidoId: string };

export function useCheckoutOrder(customer: string | null, selecting: boolean, linkedOrderId: string | null) {
  const [request, setRequest] = useReducer((_: OrderRequest | null, value: OrderRequest | null) => value, null);
  const [recovery, setRecovery] = useState<{ customer: string; order: CheckoutOrder } | null>(null);
  const [ready, setReady] = useReducer(() => true, false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [missingOrder, setMissingOrder] = useState<string | null>(null);
  const lock = useRef(false);
  const revision = useRef(0);
  const pedidoId = request && "pedidoId" in request ? request.pedidoId : null;
  const unavailable = !!customer && (missingOrder === customer || (!!request && "owner" in request && request.owner !== customer));
  const order = customer && recovery?.customer === customer && recovery.order.id === pedidoId ? recovery.order : null;

  useEffect(() => {
    if (linkedOrderId) {
      setRequest({ pedidoId: linkedOrderId });
      setReady();
      return;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (typeof saved?.pedidoId === "string" && uuid.test(saved.pedidoId)) {
        const reference = { pedidoId: saved.pedidoId };
        setRequest(reference);
        sessionStorage.setItem(storageKey, JSON.stringify(reference));
      } else if (typeof saved?.key === "string" && uuid.test(saved.key) && saved.body && typeof saved.body === "object" && !Array.isArray(saved.body)) {
        setRequest({ key: saved.key, body: saved.body, owner: typeof saved.owner === "string" ? saved.owner : null });
      }
    } catch { /* Invalid or unavailable storage does not authorize a new request. */ }
    setReady();
  }, [linkedOrderId]);

  useEffect(() => {
    if (!pedidoId || !customer || lock.current) return;
    const current = ++revision.current;
    let active = true;
    void checkoutRequest<{ pedido: CheckoutOrder }>(`/api/pedidos/${pedidoId}`).then(({ pedido }) => {
      if (!validOrder(pedido) || pedido.id !== pedidoId) throw new Error("Resposta de pedido inválida.");
      if (active && current === revision.current) {
        setRecovery({ customer, order: pedido });
        setMissingOrder(null);
      }
    }).catch(failure => {
      if (active && current === revision.current) {
        if (failure instanceof CheckoutRequestError && failure.status === 404) setMissingOrder(customer);
        setError("Não foi possível recuperar o pedido. Confirme sua identificação e tente novamente.");
      }
    });
    return () => { active = false; };
  }, [pedidoId, customer, selecting]);

  async function run(body?: Record<string, unknown>, payment?: PaymentSelection) {
    if (lock.current || !customer || unavailable) return false;
    lock.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    setCanEdit(false);
    try {
      const pending = request ?? (body ? { key: crypto.randomUUID(), body, owner: customer } : null);
      if (!pending) return false;
      // Até receber o ID, persistir a chave e o corpo original para repetir a mesma criação.
      if (!request) {
        sessionStorage.setItem(storageKey, JSON.stringify(pending));
        setRequest(pending);
      }
      const result = "pedidoId" in pending
        ? await checkoutRequest<{ pedido: CheckoutOrder }>(`/api/pedidos/${pending.pedidoId}`, payment, payment ? { method: "PATCH" } : undefined)
        : await checkoutRequest<{ pedido: CheckoutOrder }>("/api/pedidos", pending.body, { key: pending.key, checkoutScope: customer });
      if (!validOrder(result.pedido) || ("pedidoId" in pending && pending.pedidoId !== result.pedido.id)) throw new Error("Resposta de pedido inválida. Tente recuperar novamente.");
      const reference = { pedidoId: result.pedido.id };
      setRequest(reference);
      setRecovery({ customer, order: result.pedido });
      if (!("pedidoId" in pending)) sessionStorage.setItem(storageKey, JSON.stringify(reference));
      return true;
    } catch (failure) {
      if (pedidoId && failure instanceof CheckoutRequestError && failure.status === 404) setMissingOrder(customer);
      setCanEdit(!pedidoId && failure instanceof CheckoutRequestError && [400, 422].includes(failure.status));
      setError(failure instanceof Error ? failure.message : "Não foi possível recuperar o pedido.");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function finish() {
    revision.current++;
    if (!linkedOrderId) sessionStorage.removeItem(storageKey);
    if (pedidoId && (!linkedOrderId || order)) sessionStorage.removeItem(`lanche-falcao:payment-key:${pedidoId}`);
    setRequest(null);
    setRecovery(null);
    setMissingOrder(null);
    setError("");
  }

  return { request, order: unavailable ? null : order, ready, busy, error, canEdit, unavailable, start: run, changePayment: (payment: PaymentSelection) => run(undefined, payment), finish };
}
