"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCart } from "@/components/cart/cart-provider";
import type { AddressErrors, CheckoutSelection } from "@/types/checkout";
import { useCheckoutDraft } from "./use-checkout-draft";
import { DeliveryAddressForm, validateAddress } from "./delivery-address-form";
import { OrderSummary } from "./order-summary";
import styles from "./checkout-page.module.css";

export function CheckoutPage({ onContinue }: { onContinue?: (selection: CheckoutSelection) => void }) {
  const { items, ready } = useCart();
  const { orderType, setOrderType, address, setAddress, ready: draftReady } = useCheckoutDraft();
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
    const selection: CheckoutSelection = orderType === "pickup" ? { orderType } : {
      orderType,
      address: {
        postalCode: address.postalCode.trim().replace("-", ""),
        street: address.street.trim(), number: address.number.trim(),
        neighborhood: address.neighborhood.trim(), complement: address.complement.trim(), reference: address.reference.trim(),
        city: address.city.trim(), state: address.state.trim().toUpperCase(),
      },
    };
    if (onContinue) onContinue(selection);
    else setFeedback("Dados validados. A próxima etapa ainda não está disponível. Nenhum pedido foi confirmado.");
  }

  return <main className={`container ${styles.page}`}>
    <Link href="/carrinho" className={styles.back}>← Voltar ao carrinho</Link>
    <h1>Checkout</h1>
    {!ready || !draftReady ? <p role="status">Carregando checkout…</p> : items.length === 0 ? <section className={styles.empty}>
      <h2>Seu carrinho está vazio.</h2><p>Adicione produtos para iniciar o checkout.</p><Link className={styles.primary} href="/#cardapio">Ver cardápio</Link>
    </section> : <div className={styles.layout}>
      <form ref={formRef} className={styles.panel} onSubmit={submit} noValidate>
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
        <button className={styles.primary} type="submit" aria-describedby="next-step-note">Continuar</button>
        <p id="next-step-note" className={styles.hint}>A próxima etapa ainda será integrada.</p>
        <p className={styles.feedback} role="status">{feedback}</p>
      </form>
      <OrderSummary delivery={orderType === "delivery"} />
    </div>}
  </main>;
}
