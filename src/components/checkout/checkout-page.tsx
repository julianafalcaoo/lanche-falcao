"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/components/cart/cart-provider";
import type { AddressErrors, CheckoutSelection } from "@/types/checkout";
import { useCheckoutDraft } from "./use-checkout-draft";
import { DeliveryAddressForm, validateAddress } from "./delivery-address-form";
import { OrderSummary } from "./order-summary";
import { useCurrentCustomer } from "./use-current-customer";
import { CustomerIdentification } from "./customer-identification";
import { PaymentOptions } from "./payment-options";
import { paymentError, paymentSelection } from "@/lib/payment";
import { useCheckoutOrder } from "./use-checkout-order";
import { PaymentStage } from "./payment-stage";
import { CART_STORAGE_KEY, parseCart } from "@/lib/cart";
import { ExistingOrderSelection } from "./existing-order-selection";
import styles from "./checkout-page.module.css";

function goToStage(stage: "selecao" | "pagamento", replace = false, clearOrder = false) {
  const url = new URL(window.location.href);
  if (stage === "pagamento") url.searchParams.set("etapa", stage);
  else url.searchParams.delete("etapa");
  if (clearOrder) url.searchParams.delete("pedido");
  if (url.href === window.location.href) return;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}
const showPayment = () => goToStage("pagamento");
const showApproval = () => goToStage("pagamento", true);

type CheckoutProps = { deliveryFeeCents: number; onContinue?: (selection: CheckoutSelection) => void };

export function CheckoutPage(props: CheckoutProps) {
  const params = useSearchParams();
  const orderId = params.get("pedido");
  if (orderId !== null && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(orderId)) {
    return <main className={`container ${styles.page}`}>
      <h1>Checkout</h1>
      <p role="alert">Referência de pedido inválida.</p>
      <Link href="/checkout">Voltar ao checkout</Link>
    </main>;
  }
  return <CheckoutFlow key={orderId ?? "checkout"} {...props} linkedOrderId={orderId} selecting={params.get("etapa") !== "pagamento"} />;
}

function CheckoutFlow({ deliveryFeeCents, onContinue, linkedOrderId, selecting }: CheckoutProps & { linkedOrderId: string | null; selecting: boolean }) {
  const { items, ready, totalInCents, clearCart } = useCart();
  const session = useCurrentCustomer();
  const draft = useCheckoutDraft();
  const { orderType, setOrderType, address, setAddress, ready: draftReady, setPayment } = draft;
  const feeCents = orderType === "delivery" ? deliveryFeeCents : 0;
  const customer = session.status === "authenticated" ? session.customer : null;
  const flow = useCheckoutOrder(customer?.checkoutScope ?? null, selecting, linkedOrderId);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [errors, setErrors] = useState<AddressErrors>({});
  const [typeError, setTypeError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [allowAutomaticPix, setAllowAutomaticPix] = useState(false);
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
    const paymentValidation = paymentError(draft, totalInCents + feeCents);
    setPaymentMessage(paymentValidation);
    if (paymentValidation) {
      formRef.current?.querySelector<HTMLInputElement>(draft.formaPagamento ? '[name="trocoValor"]' : '[name="formaPagamento"]')?.focus();
      return;
    }
    const payment = paymentSelection(draft);
    if (!payment) return;
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
    else {
      setAllowAutomaticPix(true);
      showPayment();
      void flow.start({ tipo: selection.orderType === "pickup" ? "RETIRADA" : "ENTREGA", itens: items.map(item => ({ productId: item.productId, quantity: item.quantity })),
        ...(selection.orderType === "delivery" ? { endereco: selection.address } : {}), ...payment });
    }
  }

  return <main className={`container ${styles.page}`}>
    {(selecting || !flow.order) && <Link href="/carrinho" className={styles.back}>← Voltar ao carrinho</Link>}
    <h1>Checkout</h1>
    {!ready || !draftReady || !flow.ready ? <p role="status">Carregando checkout…</p> : flow.request && customer ? <>
      {flow.order ? selecting
        ? <ExistingOrderSelection key={`${flow.order.id}:${flow.order.formaPagamento}:${flow.order.trocoParaCentavos}`}
            order={flow.order} customerName={customer.nome} busy={flow.busy} error={flow.error} onResume={() => {
              setAllowAutomaticPix(false);
              showPayment();
            }} onApproved={showApproval}
            onChange={async payment => {
              if (!await flow.changePayment(payment)) return false;
              setAllowAutomaticPix(true);
              showPayment();
              return true;
            }} />
        : <PaymentStage key={`${flow.order.id}:${flow.order.formaPagamento}`} order={flow.order} allowAutomaticPix={allowAutomaticPix && !linkedOrderId} onChangePayment={() => {
          setAllowAutomaticPix(false);
          goToStage("selecao");
        }} onFinish={() => {
          setAllowAutomaticPix(false);
        // Preserva itens adicionados/alterados depois da criação deste pedido.
        try {
          const persistedItems = parseCart(localStorage.getItem(CART_STORAGE_KEY));
          const ordered = flow.order?.itens;
          if (!linkedOrderId && ordered && persistedItems.length === ordered.length && ordered.every(item =>
            persistedItems.some(cartItem => cartItem.productId === item.produtoId && cartItem.quantity === item.quantidade))) clearCart();
        } catch { /* Sem confirmação do carrinho persistido, preservar seus itens. */ }
        flow.finish();
        goToStage("selecao", true, true);
      }} /> : <section className={styles.panel}>
        <h2>Confirmar pedido</h2>
        <p role="status">{flow.unavailable ? "Este checkout salvo não pode ser retomado com a identificação atual." : flow.busy ? "Enviando pedido…" : "Retome a confirmação do mesmo pedido."}</p>
        {!flow.unavailable && <button className={styles.primary} disabled={flow.busy} onClick={() => void flow.start()}>Tentar novamente</button>}
        {(flow.canEdit || flow.unavailable) && <button className={styles.primary} onClick={() => {
          setAllowAutomaticPix(false);
          if (flow.unavailable && !linkedOrderId) draft.reset();
          flow.finish();
          goToStage("selecao", true, true);
        }}>{flow.unavailable ? "Iniciar novo checkout" : "Corrigir pedido"}</button>}
        <p role="alert" className={styles.error}>{flow.error}</p>
      </section>}
    </> : flow.request ? <CustomerIdentification session={session} /> : items.length === 0 ? <section className={styles.empty}>
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
      <OrderSummary feeCents={feeCents} />
    </div>}
  </main>;
}
