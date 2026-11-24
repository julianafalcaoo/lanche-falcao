"use client";

import { useCallback, useState, type FormEvent } from "react";
import { paymentError, paymentSelection, type PaymentDraft, type PaymentSelection } from "@/lib/payment";
import type { CheckoutOrder, PaymentView } from "@/types/checkout-payment";
import { checkoutRequest } from "./payment-api";
import { PaymentOptions } from "./payment-options";
import { OrderTotals } from "./order-summary";
import { usePaymentPolling } from "./use-payment-polling";
import styles from "./checkout-page.module.css";

export function ExistingOrderSelection({ order, customerName, busy, error, onChange, onResume, onApproved }: {
  order: CheckoutOrder;
  customerName: string;
  busy: boolean;
  error: string;
  onChange: (payment: PaymentSelection) => Promise<boolean>;
  onResume: () => void;
  onApproved: () => void;
}) {
  const [draft, setDraft] = useState<PaymentDraft>({
    formaPagamento: order.formaPagamento,
    precisaTroco: order.trocoParaCentavos !== null,
    trocoValor: order.trocoParaCentavos === null ? "" : (order.trocoParaCentavos / 100).toFixed(2).replace(".", ","),
  });
  const [view, setView] = useState<PaymentView | null>(null);
  const [paymentMessage, setPaymentMessage] = useState("");
  const load = useCallback((signal?: AbortSignal) => checkoutRequest<PaymentView>(`/api/pedidos/${order.id}/pagamento`, undefined, { signal }), [order.id]);
  const apply = useCallback((result: PaymentView) => {
    setView(result);
    if (result.pedido.statusPagamento === "APROVADO") onApproved();
  }, [onApproved]);
  const awaiting = view?.tentativa?.aguardando === true;

  const check = useCallback(async (signal: AbortSignal) => {
    const result = await load(signal);
    if (!signal.aborted) apply(result);
    return result.pedido.statusPagamento === "PENDENTE";
  }, [load, apply]);
  const polling = usePaymentPolling(true, check, true);
  const statusError = polling.failed ? "Não foi possível verificar o pagamento. Vamos tentar de novo automaticamente." : "";

  const changeAllowed = view && !view.tentativa && view.pedido.statusPagamento === "PENDENTE"
    && view.pedido.formaPagamento === order.formaPagamento && order.status === "PEDIDO_RECEBIDO" && !statusError;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!changeAllowed || busy || polling.accessDenied) return;
    const message = paymentError(draft, order.totalCentavos);
    const payment = paymentSelection(draft);
    setPaymentMessage(message);
    if (message || !payment) return;
    if (!await onChange(payment)) polling.refresh();
  }

  if (polling.accessDenied) return <section className={styles.panel}>
    <p role="alert">Não foi possível acessar este pedido. Confirme sua identificação e recarregue o checkout.</p>
  </section>;
  return <section className={styles.panel}>
    <h2>Forma de pagamento do pedido</h2>
    <p className={styles.feedback}>{customerName}</p>
    <p>{order.tipo === "ENTREGA" ? "Entrega" : "Retirada na lanchonete"}</p>
    {order.endereco && <p>{order.endereco.street}, {order.endereco.number} · {order.endereco.neighborhood} · {order.endereco.city}/{order.endereco.state} · CEP {order.endereco.postalCode}{order.endereco.complement && ` · ${order.endereco.complement}`}{order.endereco.reference && ` · ${order.endereco.reference}`}</p>}
    <ul className={styles.items}>{order.itens.map(item => <li key={item.produtoId}>{item.quantidade} × {item.nomeProduto}</li>)}</ul>
    <OrderTotals {...order} />
    {changeAllowed ? <form onSubmit={submit}>
      <PaymentOptions payment={draft} onChange={setDraft} error={paymentMessage} />
      <button className={styles.primary} disabled={busy}>Continuar para pagamento</button>
    </form> : <p role="status" className={styles.hint}>
      {statusError || (!view ? "Verificando a situação do pedido…" : awaiting
        ? "Existe um pagamento em andamento. Retome-o para consultar ou concluir antes de escolher outra forma."
        : "A forma de pagamento está bloqueada para este pedido. Retome-o para ver os detalhes.")}
    </p>}
    <button type="button" className={styles.back} disabled={busy} onClick={onResume}>Retomar pagamento</button>
    <p className={styles.error} role="alert">{error}</p>
  </section>;
}
