"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { CardData } from "@/types/checkout-payment";
import { checkoutRequest } from "./payment-api";
import styles from "./checkout-page.module.css";

interface BrickController { unmount(): Promise<void> }
interface MPInstance { bricks(): { create(type: string, id: string, settings: { initialization: { amount: number; payer?: { email: string } }; callbacks: { onReady(): void; onError(): void; onSubmit(data: CardData, additional: { paymentTypeId: string }): Promise<void> } }): Promise<BrickController> } }
declare global { interface Window { MercadoPago?: new (key: string, options: { locale: string }) => MPInstance } }

export function CardPayment({ total, onSubmit }: { total: number; onSubmit: (data: CardData, paymentType: string) => Promise<void> }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const containerId = reload === 0 ? "card-payment-brick" : `card-payment-brick-${reload}`;
  const submit = useRef(onSubmit);
  useEffect(() => { submit.current = onSubmit; }, [onSubmit]);
  useEffect(() => {
    if (!sdkReady) return;
    let disposed = false;
    let controller: BrickController | undefined;
    void checkoutRequest<{ publicKey: string; payerEmail: string | null }>("/api/pagamentos/config").then(async config => {
      if (disposed) return;
      if (!window.MercadoPago) throw new Error("SDK indisponível");
      const mp = new window.MercadoPago(config.publicKey, { locale: "pt-BR" });
      controller = await mp.bricks().create("cardPayment", containerId, {
        // Sem e-mail disponível no cadastro, o próprio Brick solicita o dado real.
        initialization: { amount: total / 100, ...(config.payerEmail ? { payer: { email: config.payerEmail } } : {}) },
        callbacks: { onReady() { if (!disposed) setReady(true); }, onError() { if (!disposed) setError("Não foi possível carregar o formulário seguro de cartão."); },
          onSubmit(data, additional) {
            if (disposed) return Promise.resolve();
            if (!data?.payer?.email || !["credit_card", "debit_card"].includes(additional?.paymentTypeId) || !data.token) {
              setError("Confira os dados e preencha o formulário do cartão novamente.");
              return Promise.resolve();
            }
            setError("");
            return submit.current(data, additional.paymentTypeId);
          } },
      });
      if (disposed) await controller.unmount();
    }).catch(() => { if (!disposed) setError("Formulário de cartão indisponível. Tente novamente em instantes."); });
    return () => { disposed = true; void Promise.resolve().then(() => controller?.unmount()).catch(() => {}); };
  }, [sdkReady, total, containerId]);
  return <div className={styles.payment}>
    <p className={styles.hint}>Preencha os dados no formulário a seguir para pagar com cartão.</p>
    <Script src="https://sdk.mercadopago.com/js/v2" strategy="afterInteractive" onReady={() => setSdkReady(true)} onError={() => setError("Não foi possível carregar o formulário seguro de cartão. Recarregue a página para retomar o pedido.")} />
    <div key={containerId} id={containerId} />
    {!ready && !error && <p role="status">Carregando formulário seguro…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && sdkReady && <button className={styles.retry} type="button" onClick={() => {
      setReady(false);
      setError("");
      setReload(current => current + 1);
    }}>Recarregar formulário de cartão</button>}
  </div>;
}
