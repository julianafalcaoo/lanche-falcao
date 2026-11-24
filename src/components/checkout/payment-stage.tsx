"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardData, CheckoutOrder, PaymentView } from "@/types/checkout-payment";
import { emptyPayment, paymentError, reaisToCentavos } from "@/lib/payment";
import { CardPayment } from "./card-payment";
import { PaymentOptions } from "./payment-options";
import { checkoutRequest, CheckoutRequestError, validOrder } from "./payment-api";
import styles from "./checkout-page.module.css";

export function PaymentStage({ order, cardAvailable, onMethodChanged, onFinish }: {
  order: CheckoutOrder; cardAvailable: boolean; onMethodChanged: (order: CheckoutOrder) => void; onFinish: () => void;
}) {
  const [view, setView] = useState<PaymentView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pixEnvironment, setPixEnvironment] = useState<"test" | "production" | null>(null);
  const [email, setEmail] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState(emptyPayment);
  const lock = useRef(false);
  const loadingView = useRef(true);
  const [lastPayload, setLastPayload] = useState<object | null>(null);
  const clientKey = useRef<string | null>(null);
  const api = `/api/pedidos/${order.id}/pagamento`;
  const pay = useCallback(async (body?: object) => {
    if (lock.current || loadingView.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (body) {
        const keyName = `lanche-falcao:payment-key:${order.id}`;
        clientKey.current ??= sessionStorage.getItem(keyName) ?? crypto.randomUUID();
        sessionStorage.setItem(keyName, clientKey.current);
        setLastPayload(body);
      }
      const data = await checkoutRequest<PaymentView>(api, body ?? { consultar: true }, body ? clientKey.current! : undefined);
      if (data.pedido.formaPagamento !== order.formaPagamento) {
        onMethodChanged(data.pedido);
        return true;
      }
      setView(data);
      if (data.tentativa && !data.tentativa.codigoErro) setLastPayload(null);
      if (data.tentativa?.codigoErro) setError(data.tentativa.podeTentarNovamente ? "O pagamento não foi iniciado. Tente novamente em instantes." : "Não foi possível confirmar o pagamento. Verifique novamente ou repita esta tentativa.");
      return true;
    } catch (failure) {
      if (failure instanceof CheckoutRequestError && failure.status === 422) {
        setLastPayload(null);
        sessionStorage.removeItem(`lanche-falcao:payment-key:${order.id}`);
        clientKey.current = null;
      }
      setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "A resposta demorou. Verifique o pagamento antes de tentar novamente.");
      return false;
    }
    finally { lock.current = false; setBusy(false); }
  }, [api, order.formaPagamento, order.id, onMethodChanged]);
  useEffect(() => {
    let active = true;
    loadingView.current = true;
    void checkoutRequest<PaymentView>(api).then(async data => {
      if (!active) return;
      loadingView.current = false;
      setView(data);
      if (data.pedido.formaPagamento === "PIX") {
        const config = await checkoutRequest<{ ambiente: "test" | "production" }>("/api/pagamentos/config");
        if (!active) return;
        if (config.ambiente !== "test" && config.ambiente !== "production") throw new Error("Ambiente inválido");
        setPixEnvironment(config.ambiente);
        if (config.ambiente === "test" && data.pedido.statusPagamento !== "APROVADO" && !data.tentativa) void pay({ iniciarPix: true });
      }
    }).catch(() => {
      if (active) {
        loadingView.current = false;
        setError("Não foi possível consultar o pagamento. Tente verificar novamente.");
      }
    });
    return () => { active = false; };
  }, [api, pay]);
  async function cardSubmit(data: CardData, paymentType: string) {
    // Lista explícita: nunca encaminha formData integral nem total informado pelo SDK.
    await pay({
      payer: { email: data.payer.email, ...(data.payer.identification ? { identification: { type: data.payer.identification.type, number: data.payer.identification.number } } : {}) },
      card: { token: data.token, payment_method_id: data.payment_method_id, installments: data.installments, payment_type_id: paymentType }
    });
  }
  function newAttempt() {
    sessionStorage.removeItem(`lanche-falcao:payment-key:${order.id}`);
    clientKey.current = null; setLastPayload(null); setView(current => current ? { ...current, tentativa: null } : null); setError("");
    if (order.formaPagamento === "PIX" && pixEnvironment === "test") void pay({ iniciarPix: true });
  }
  const current = view?.pedido ?? order;
  const polling = current.formaPagamento === "PIX" && current.statusPagamento === "PENDENTE" &&
    (!view || Boolean(view.tentativa?.aguardando || lastPayload));
  useEffect(() => {
    if (!polling) return;
    let disposed = false;
    let timer: number | undefined;
    let running = false;
    let failures = 0;
    function schedule(delay: number) {
      window.clearTimeout(timer);
      if (!disposed && !document.hidden && !running) timer = window.setTimeout(tick, delay);
    }
    async function tick() {
      if (disposed || document.hidden) return;
      running = true;
      const success = await pay();
      if (success !== undefined) failures = success ? 0 : Math.min(failures + 1, 3);
      running = false;
      schedule(Math.min(12000 * 2 ** failures, 60000));
    }
    function visibilityChanged() { schedule(0); }
    schedule(5000);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [pay, polling]);
  const cash = current.formaPagamento === "DINHEIRO";
  const approved = current.statusPagamento === "APROVADO";
  const cardBlocked = current.formaPagamento === "CARTAO" && !cardAvailable;
  const afterPaymentMessage = { ESTORNADO: "Pagamento estornado integralmente.", ESTORNADO_PARCIAL: "Pagamento estornado parcialmente.", CONTESTADO: "Pagamento em contestação. Entre em contato com a lanchonete." }[current.statusPagamento as "ESTORNADO" | "ESTORNADO_PARCIAL" | "CONTESTADO"];
  const canStart = view && !view.tentativa && !cash && !approved && !lastPayload;
  async function changeMethod() {
    if (lock.current || !view || view.tentativa || lastPayload) return;
    const validation = paymentError(selection, current.totalCentavos);
    if (validation) { setError(validation); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      const payment = selection.formaPagamento === "DINHEIRO"
        ? { formaPagamento: "DINHEIRO", precisaTroco: selection.precisaTroco, trocoParaCentavos: selection.precisaTroco ? reaisToCentavos(selection.trocoValor) : null }
        : { formaPagamento: selection.formaPagamento };
      const result = await checkoutRequest<{ pedido: CheckoutOrder }>(`/api/pedidos/${order.id}`, payment, undefined, "PATCH");
      if (!validOrder(result.pedido) || result.pedido.id !== order.id) throw new Error("Resposta de pedido inválida.");
      onMethodChanged(result.pedido);
      setSelecting(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível alterar o pagamento.");
    } finally { lock.current = false; setBusy(false); }
  }
  if (selecting && current.statusPagamento === "PENDENTE") {
    const blocked = !view || view.tentativa || lastPayload;
    return <section className={styles.panel} aria-busy={busy}>
      <h2>Alterar forma de pagamento</h2>
      <p>Total: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(current.totalCentavos / 100)}</p>
      {blocked ? <p role="status">A troca está indisponível enquanto houver uma tentativa registrada ou situação incerta. Volte ao pagamento para acompanhar este pedido.</p>
        : <form onSubmit={event => { event.preventDefault(); void changeMethod(); }}>
          <PaymentOptions payment={selection} cardAvailable={cardAvailable} error={error} onChange={value => { setSelection(value); setError(""); }} />
          <button className={styles.primary} type="submit" disabled={busy}>Confirmar forma de pagamento</button>
        </form>}
      <button className={styles.primary} type="button" disabled={busy} onClick={() => { setSelecting(false); setError(""); }}>Voltar ao pagamento</button>
    </section>;
  }
  return <section className={styles.panel} aria-busy={busy}>
    <h2>{cash ? "Pedido criado" : current.formaPagamento === "PIX" ? "Pagamento via Pix" : "Pagamento com cartão"}</h2>
    <p className={styles.feedback}>Total: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(current.totalCentavos / 100)}</p>
    <p role="status">{cash ? "Pagamento em dinheiro no recebimento/retirada." : afterPaymentMessage ?? (approved ? "Pagamento aprovado." : current.statusPagamento === "RECUSADO" ? "Pagamento recusado." : current.statusPagamento === "CANCELADO" ? "Pagamento cancelado ou expirado." : "Aguardando confirmação do pagamento.")}</p>
    {cardBlocked && !approved && <p className={styles.hint}>Cartão temporariamente indisponível para novos pagamentos.</p>}
    {canStart && current.formaPagamento === "CARTAO" && cardAvailable && <CardPayment total={current.totalCentavos} onSubmit={cardSubmit} />}
    {canStart && current.formaPagamento === "PIX" && pixEnvironment === "production" && <form onSubmit={event => {
      event.preventDefault();
      void pay({ payer: { email: email.trim() } });
    }}>
      <div className={styles.field}><label htmlFor="payment-email">E-mail do comprador</label>
        <input id="payment-email" name="paymentEmail" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
      </div>
      <button className={styles.primary} type="submit" disabled={busy}>Gerar Pix</button>
    </form>}
    {!cash && !approved && <p className={styles.hint}>Pedido criado. O preparo depende da confirmação do pagamento.</p>}
    {view?.tentativa?.qrCode && current.statusPagamento === "PENDENTE" && <div className={styles.payment}>
      <p>Escaneie o QR Code ou copie o código Pix para realizar o pagamento.</p>
      {/* Base64 PNG validado pelo backend, fornecido exclusivamente pelo Mercado Pago. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {view.tentativa.qrCodeBase64 && <img className={styles.pixQr} src={`data:image/png;base64,${view.tentativa.qrCodeBase64}`} alt="QR Code Pix do pedido" />}
      <div className={styles.field}><label htmlFor="pix-code">Pix Copia e Cola</label><textarea id="pix-code" readOnly value={view.tentativa.qrCode} /></div>
      <button type="button" className={styles.primary} onClick={() => { void navigator.clipboard.writeText(view.tentativa!.qrCode!).then(() => setCopied(true)).catch(() => setError("Selecione o código e copie manualmente.")); }}>Copiar código Pix</button>
      <p role="status">{copied ? "Código Pix copiado." : ""}</p>
      {view.tentativa.ticketUrl && <a className={styles.back} href={view.tentativa.ticketUrl} target="_blank" rel="noopener noreferrer">Ver instruções do Pix</a>}
    </div>}
    {!cash && !approved && <button type="button" className={styles.primary} disabled={busy} onClick={() => void pay()}>Verificar pagamento</button>}
    {current.statusPagamento === "PENDENTE" && <button type="button" className={styles.primary} disabled={busy} onClick={() => {
      setSelecting(true); setSelection(emptyPayment); setError("");
      if (!view || view.tentativa?.aguardando || lastPayload) void pay();
    }}>Alterar forma de pagamento</button>}
    {!cardBlocked && lastPayload && (!view?.tentativa || (view.tentativa.aguardando && view.tentativa.codigoErro)) && <button className={styles.primary} disabled={busy} onClick={() => void pay(lastPayload)}>Repetir mesma tentativa</button>}
    {!cardBlocked && view?.tentativa?.podeTentarNovamente && <button className={styles.primary} disabled={busy} onClick={newAttempt}>Tentar pagamento novamente</button>}
    {(cash || approved) && <button className={styles.primary} onClick={onFinish}>Concluir pedido</button>}
    <p className={styles.error} role="alert">{error}</p>
  </section>;
}
