"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCart } from "@/components/cart/cart-provider";
import type { AddressErrors, CheckoutSelection } from "@/types/checkout";
import { useCheckoutDraft } from "./use-checkout-draft";
import { DeliveryAddressForm, validateAddress } from "./delivery-address-form";
import { OrderSummary } from "./order-summary";
import { useCurrentCustomer } from "./use-current-customer";
import { CustomerIdentification } from "./customer-identification";
import { PaymentOptions } from "./payment-options";
import { paymentError, reaisToCentavos, type PaymentSelection } from "@/lib/payment";
import { useCheckoutOrder } from "./use-checkout-order";
import { PaymentStage } from "./payment-stage";
import { checkoutIntent } from "@/lib/checkout-intent";
import { CART_STORAGE_KEY, parseCart } from "@/lib/cart";
import styles from "./checkout-page.module.css";

export function CheckoutPage({ onContinue }: { onContinue?: (selection: CheckoutSelection) => void }) {
  const { items, ready, totalInCents, clearCart } = useCart();
  const session = useCurrentCustomer();
  const draft = useCheckoutDraft();
  const { orderType, setOrderType, address, setAddress, ready: draftReady, setPayment } = draft;
  const intentBody = { tipo: orderType === "pickup" ? "RETIRADA" : orderType === "delivery" ? "ENTREGA" : null, itens: items,
    endereco: address, formaPagamento: draft.formaPagamento, precisaTroco: draft.precisaTroco,
    trocoParaCentavos: draft.precisaTroco ? reaisToCentavos(draft.trocoValor) : null };
  const intent = checkoutIntent(intentBody);
  const flow = useCheckoutOrder(ready && draftReady ? intent : null);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [errors, setErrors] = useState<AddressErrors>({});
  const [typeError, setTypeError] = useState("");
  const [feedback, setFeedback] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    if (!ready || !draftReady || items.length === 0) return;
    if (!orderType) {
      setTypeError("Escolha Retirada ou Entrega para continuar.");
      formRef.current?.querySelector<HTMLInputElement>('input[name="orderType"]')?.focus();
      return;
    }
    const nextErrors = orderType === "delivery" ? validateAddress(address) : {};
    setErrors(nextErrors);
    const firstError = Object.keys(nextErrors)[0];
    if (firstError) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstError}"]`)?.focus();
      return;
    }
    if (session.status !== "authenticated" || session.loggingOut) {
      setFeedback("Conclua sua identificação para continuar.");
      return;
    }
    const paymentValidation = paymentError(draft, totalInCents);
    setPaymentMessage(paymentValidation);
    if (paymentValidation) {
      formRef.current?.querySelector<HTMLInputElement>(draft.formaPagamento ? '[name="trocoValor"]' : '[name="formaPagamento"]')?.focus();
      return;
    }
    const payment: PaymentSelection = draft.formaPagamento === "DINHEIRO"
      ? { formaPagamento: "DINHEIRO", precisaTroco: draft.precisaTroco, trocoParaCentavos: draft.precisaTroco ? reaisToCentavos(draft.trocoValor) : null }
      : { formaPagamento: draft.formaPagamento as "PIX" | "CARTAO" };
    const selection: CheckoutSelection = orderType === "pickup" ? { orderType, ...payment } : {
      ...payment,
      orderType,
      address: {
        postalCode: address.postalCode.trim().replace("-", ""),
        street: address.street.trim(), number: address.number.trim(),
        neighborhood: address.neighborhood.trim(), complement: address.complement.trim(), reference: address.reference.trim(),
        city: address.city.trim(), state: address.state.trim().toUpperCase(),
      },
    };
    if (onContinue) onContinue(selection);
    else void flow.start({ tipo: selection.orderType === "pickup" ? "RETIRADA" : "ENTREGA", itens: items.map(item => ({ productId: item.productId, quantity: item.quantity })),
      ...(selection.orderType === "delivery" ? { endereco: selection.address } : {}), ...payment });
  }

  return <main className={`container ${styles.page}`}>
    <Link href="/carrinho" className={styles.back}>← Voltar ao carrinho</Link>
    <h1>Checkout</h1>
    {!ready || !draftReady || !flow.ready ? <p role="status">Carregando checkout…</p> : flow.request && session.status === "authenticated" ? <>
      {flow.order ? <PaymentStage key={flow.order.id} order={flow.order} onFinish={() => {
        // Preserva itens adicionados/alterados depois da criação deste pedido.
        try {
          const persistedItems = parseCart(localStorage.getItem(CART_STORAGE_KEY));
          if (flow.request && checkoutIntent(flow.request.body) === intent && checkoutIntent({ ...intentBody, itens: persistedItems }) === intent) clearCart();
        } catch { /* Sem confirmação do carrinho persistido, preservar seus itens. */ }
        flow.finish();
      }} /> : <section className={styles.panel}><h2>Confirmar pedido</h2><p role="status">{flow.busy ? "Enviando pedido…" : "Retome a confirmação do mesmo pedido."}</p><button className={styles.primary} disabled={flow.busy} onClick={() => void flow.start()}>Tentar novamente</button>{flow.canEdit && <button className={styles.primary} onClick={flow.finish}>Corrigir pedido</button>}<p role="alert" className={styles.error}>{flow.error}</p></section>}
    </> : items.length === 0 ? <section className={styles.empty}>
      <h2>Seu carrinho está vazio.</h2><p>Adicione produtos para iniciar o checkout.</p><Link className={styles.primary} href="/#cardapio">Ver cardápio</Link>
    </section> : <div className={styles.layout}>
      <div className={styles.panel}>
      <form id="checkout-delivery" ref={formRef} onSubmit={submit} noValidate>
        <fieldset className={styles.orderType} aria-describedby={typeError ? "order-type-error" : undefined}>
          <legend>Como você quer receber seu pedido?</legend>
          <div className={styles.options}>{([{ value: "pickup", label: "Retirar na lanchonete" }, { value: "delivery", label: "Entrega" }] as const).map((option) => <label className={styles.option} key={option.value}>
            <input type="radio" name="orderType" value={option.value} checked={orderType === option.value} required aria-describedby={typeError ? "order-type-error" : undefined} onChange={() => { setOrderType(option.value); setTypeError(""); setErrors({}); setFeedback(""); }} />
            <span>{option.label}</span>
          </label>)}</div>
          {typeError && <p id="order-type-error" className={styles.error}>{typeError}</p>}
        </fieldset>
        {orderType === "pickup" && <p className={styles.pickup}>Você escolheu retirar na lanchonete.</p>}
        {orderType === "delivery" && <DeliveryAddressForm address={address} errors={errors} onChange={(field, value) => {
          setAddress((current) => ({ ...current, [field]: value }));
          setErrors((current) => ({ ...current, [field]: undefined }));
          setFeedback("");
        }} />}
        <PaymentOptions payment={draft} error={paymentMessage} onChange={(value) => { setPayment(value); setPaymentMessage(""); setFeedback(""); }} />
      </form>
        <CustomerIdentification session={session} />
        <button className={styles.primary} type="submit" form="checkout-delivery" disabled={session.status !== "authenticated" || session.loggingOut || flow.busy} aria-describedby="next-step-note">Finalizar pedido</button>
        <p id="next-step-note" className={styles.hint}>{session.status === "authenticated" ? "Após validar seus dados, a próxima etapa será o pagamento." : "Confirme sua identificação para continuar."}</p>
        <p className={styles.feedback} role="status">{session.status === "authenticated" ? feedback : ""}</p>
        <p className={styles.error} role="alert">{flow.error}</p>
      </div>
      <OrderSummary delivery={orderType === "delivery"} />
    </div>}
  </main>;
}
