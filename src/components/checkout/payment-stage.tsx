"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardData, CheckoutOrder, PaymentView } from "@/types/checkout-payment";
import { pixQrMime } from "@/lib/pix-qr";
import { CardPayment } from "./card-payment";
import { CardChallenge } from "./card-challenge";
import { checkoutRequest, CheckoutRequestError } from "./payment-api";
import { OrderTotals } from "./order-summary";
import { usePaymentPolling } from "./use-payment-polling";
import styles from "./checkout-page.module.css";

function needsChallenge(view: PaymentView) {
  return view.pedido.formaPagamento === "CARTAO" && view.pedido.statusPagamento === "PENDENTE"
    && view.tentativa?.aguardando && view.tentativa.statusExterno === "action_required" && view.tentativa.detalheExterno === "pending_challenge";
}

export function PaymentStage({ order, allowAutomaticPix, onChangePayment, onFinish }: {
  order: CheckoutOrder; allowAutomaticPix: boolean; onChangePayment: () => void; onFinish: () => void;
}) {
  const [view, setView] = useState<PaymentView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pixEnvironment, setPixEnvironment] = useState<"test" | "production" | null>(null);
  const [email, setEmail] = useState("");
  const lock = useRef(false);
  const [lastPayload, setLastPayload] = useState<object | null>(null);
  const clientKey = useRef<string | null>(null);
  const mutation = useRef(0);
  const recoverNow = useRef(false);
  const recovery = useRef<{ id: string; next: number; interval: number } | null>(null);
  const challenge = useRef<{ id: string; url: string } | null>(null);
  const api = `/api/pedidos/${order.id}/pagamento`;
  const updateView = useCallback((data: PaymentView) => {
    if (!needsChallenge(data) || !data.tentativa) challenge.current = null;
    else if (challenge.current?.id !== data.tentativa.id) {
      // Consultas de status não devem recarregar o iframe enquanto o titular está usando o mesmo desafio.
      challenge.current = data.desafio3dsUrl ? { id: data.tentativa.id, url: data.desafio3dsUrl } : null;
    }
    setView(challenge.current ? { ...data, desafio3dsUrl: challenge.current.url } : data);
  }, []);
  const pay = useCallback(async (body?: object) => {
    if (lock.current) return;
    mutation.current++;
    lock.current = true; setBusy(true); setError("");
    try {
      if (body) {
        const keyName = `lanche-falcao:payment-key:${order.id}`;
        clientKey.current ??= sessionStorage.getItem(keyName) ?? crypto.randomUUID();
        sessionStorage.setItem(keyName, clientKey.current);
        setLastPayload(body);
      }
      const data = await checkoutRequest<PaymentView>(api, body ?? { consultar: true }, body ? { key: clientKey.current! } : undefined);
      updateView(data);
      if (data.tentativa && (data.pedido.formaPagamento === "PIX"
        ? !data.tentativa.codigoErro
        : !!data.tentativa.statusExterno || data.tentativa.podeTentarNovamente)) setLastPayload(null);
      if (data.tentativa?.aguardando && data.tentativa.codigoErro) setError("O resultado ainda é incerto. Retome a mesma tentativa antes de iniciar outro pagamento.");
      if (data.tentativa?.podeTentarNovamente && !data.tentativa.statusExterno && data.tentativa.codigoErro !== "CARTAO_TOKEN_INVALIDO") setError("Não foi possível iniciar o pagamento. Tente novamente em instantes.");
    } catch (failure) {
      if (failure instanceof CheckoutRequestError && failure.status === 422) {
        setLastPayload(null);
        sessionStorage.removeItem(`lanche-falcao:payment-key:${order.id}`);
        clientKey.current = null;
      }
      setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "A resposta demorou. Verifique o pagamento antes de tentar novamente.");
    }
    finally { lock.current = false; setBusy(false); }
  }, [api, order.id, updateView]);
  useEffect(() => {
    if (order.formaPagamento !== "DINHEIRO") return;
    let active = true;
    void checkoutRequest<PaymentView>(api).then(data => {
      if (active) setView(data);
    }).catch(() => { if (active) setError("Não foi possível consultar o pagamento. Tente verificar novamente."); });
    return () => { active = false; };
  }, [api, order.formaPagamento]);

  const emptyPendingPix = view?.pedido.formaPagamento === "PIX" && view.pedido.statusPagamento === "PENDENTE" && !view.tentativa;
  const needsPixConfig = pixEnvironment === null && view?.pedido.formaPagamento === "PIX" && !view.tentativa
    && ["PENDENTE", "RECUSADO", "CANCELADO"].includes(view.pedido.statusPagamento);
  useEffect(() => {
    if (!needsPixConfig) return;
    let active = true;
    void checkoutRequest<{ ambiente: "test" | "production" }>("/api/pagamentos/config").then(config => {
      if (!active) return;
      if (config.ambiente !== "test" && config.ambiente !== "production") throw new Error("Ambiente inválido");
      setPixEnvironment(config.ambiente);
      // A iniciação automática existente é exclusiva de sandbox e ocorre somente na entrada inicial.
      if (allowAutomaticPix && emptyPendingPix && config.ambiente === "test" && !sessionStorage.getItem(`lanche-falcao:payment-key:${order.id}`)) void pay({ iniciarPix: true });
    }).catch(() => { if (active) setError("Não foi possível carregar o Pix. Recarregue a página para retomar o pedido."); });
    return () => { active = false; };
  }, [allowAutomaticPix, emptyPendingPix, needsPixConfig, order.id, pay]);

  const uncertain = !!lastPayload;
  const checkPayment = useCallback(async (signal: AbortSignal) => {
    if (lock.current) return true;
    const version = mutation.current;
    let data = await checkoutRequest<PaymentView>(api, undefined, { signal });
    if (signal.aborted || version !== mutation.current) return true;
    updateView(data);
    if (data.pedido.formaPagamento === "DINHEIRO") return false;
    if (data.pedido.statusPagamento !== "PENDENTE") {
      setLastPayload(null);
      setError("");
      return false;
    }
    // Uma leitura pode cruzar a transação do webhook entre o pedido e a tentativa.
    // Só o estado persistido no pedido encerra o acompanhamento normal.
    if (!data.tentativa?.aguardando) return !!data.tentativa || uncertain;

    const now = performance.now();
    if (recovery.current?.id !== data.tentativa.id) {
      const interval = data.pedido.formaPagamento === "PIX" ? 60000 : 15000;
      const needsUrl = needsChallenge(data) && !challenge.current;
      recovery.current = { id: data.tentativa.id, next: needsUrl ? now : now + interval, interval };
    }
    const schedule = recovery.current;
    if (!document.hidden && (recoverNow.current || now >= schedule.next)) {
      recoverNow.current = false;
      schedule.next = now + schedule.interval;
      schedule.interval = Math.min(schedule.interval * 2, 240000);
      data = await checkoutRequest<PaymentView>(api, { consultar: true }, { signal });
      if (signal.aborted || version !== mutation.current) return true;
      updateView(data);
    }
    if (data.tentativa?.statusExterno && !data.tentativa.codigoErro) {
      setLastPayload(null);
      setError("");
    }
    return data.pedido.statusPagamento === "PENDENTE" && (!!data.tentativa || uncertain);
  }, [api, uncertain, updateView]);

  const paymentPolling = order.formaPagamento !== "DINHEIRO" && (!view ||
    (view.pedido.formaPagamento !== "DINHEIRO" && view.pedido.statusPagamento === "PENDENTE" && (!!view.tentativa || uncertain)));
  const polling = usePaymentPolling(paymentPolling, checkPayment, true);
  function recoverPayment() {
    recoverNow.current = true;
    polling.refresh();
  }
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
  const cash = current.formaPagamento === "DINHEIRO";
  const pix = current.formaPagamento === "PIX";
  const card = current.formaPagamento === "CARTAO";
  const approved = current.statusPagamento === "APROVADO";
  const cardError = card ? view?.tentativa?.codigoErro : null;
  const declineMessage = cardError === "CARTAO_TOKEN_INVALIDO" ? "A validação do cartão expirou ou foi recusada. Preencha o formulário novamente."
    : cardError === "CARTAO_3DS_RECUSADO" ? "A autenticação do cartão foi recusada pelo banco."
    : "Pagamento recusado.";
  const canceledMessage = pix
    ? view?.tentativa?.detalheExterno === "expired" ? "Pix expirado. O vencimento foi confirmado." : "Pix cancelado."
    : cardError === "CARTAO_3DS_EXPIRADO" || view?.tentativa?.detalheExterno === "expired"
      ? "A tentativa de cartão expirou. Você pode tentar novamente."
      : "Pagamento cancelado.";
  const afterPaymentMessage = { ESTORNADO: "Pagamento estornado integralmente.", ESTORNADO_PARCIAL: "Pagamento estornado parcialmente.", CONTESTADO: "Pagamento em contestação. Entre em contato com a lanchonete." }[current.statusPagamento as "ESTORNADO" | "ESTORNADO_PARCIAL" | "CONTESTADO"];
  const canStart = view && !view.tentativa && !cash && !approved && !afterPaymentMessage && !lastPayload;
  const canRetry = view?.tentativa?.podeTentarNovamente
    && (current.statusPagamento === "RECUSADO" || current.statusPagamento === "CANCELADO");
  const awaitingChallenge = view && needsChallenge(view);
  const qrMime = pixQrMime(view?.tentativa?.qrCodeBase64);
  if (polling.accessDenied) return <section className={styles.panel}>
    <p role="alert">Não foi possível acessar este pagamento. Confirme sua identificação e recarregue o checkout.</p>
  </section>;
  return <section className={styles.panel} aria-busy={busy}>
    <h2>{cash ? "Pedido criado" : current.formaPagamento === "PIX" ? "Pagamento via Pix" : "Pagamento com cartão"}</h2>
    {!approved && !afterPaymentMessage && <button type="button" className={styles.back} disabled={busy} onClick={onChangePayment}>Alterar forma de pagamento</button>}
    <OrderTotals subtotalCentavos={order.subtotalCentavos} taxaEntregaCentavos={order.taxaEntregaCentavos} totalCentavos={order.totalCentavos} />
    {cash && order.trocoParaCentavos !== null && <p>Troco: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((order.trocoParaCentavos - order.totalCentavos) / 100)}</p>}
    <p role="status">{card && busy ? "Processando o pagamento com cartão…" : cash ? "Pagamento em dinheiro no recebimento/retirada." : afterPaymentMessage ?? (approved ? "Pagamento aprovado." : current.statusPagamento === "RECUSADO" ? declineMessage : current.statusPagamento === "CANCELADO" ? canceledMessage : "Aguardando confirmação do pagamento.")}</p>
    {paymentPolling && (pix || view?.tentativa || uncertain || polling.failed) && (view || polling.failed) && <p className={styles.hint} role="status">{polling.failed
      ? "Falha temporária na consulta. Vamos tentar de novo automaticamente."
      : view?.tentativa?.codigoErro || (uncertain && !view?.tentativa?.statusExterno)
        ? "O resultado ainda não foi confirmado. Estamos consultando a mesma tentativa."
        : pix ? "O status do Pix é atualizado automaticamente." : "O status do cartão é atualizado automaticamente."}</p>}
    {awaitingChallenge && (view?.desafio3dsUrl
      ? <CardChallenge key={view.tentativa?.id} url={view.desafio3dsUrl} onComplete={recoverPayment} />
      : <p role="status">Recuperando a autenticação do cartão. Aguarde nesta tela ou retome o mesmo pedido.</p>)}
    {canStart && current.formaPagamento === "CARTAO" && <CardPayment total={order.totalCentavos} onSubmit={cardSubmit} />}
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
      <p>{qrMime ? "Escaneie o QR Code ou copie o código Pix para realizar o pagamento." : "Copie o código Pix para realizar o pagamento."}</p>
      {/* Apenas imagens PNG ou JPEG fornecidas pelo Mercado Pago. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qrMime && <img className={styles.pixQr} src={`data:${qrMime};base64,${view.tentativa.qrCodeBase64}`} alt="QR Code Pix do pedido" />}
      <div className={styles.field}><label htmlFor="pix-code">Pix Copia e Cola</label><textarea id="pix-code" readOnly value={view.tentativa.qrCode} /></div>
      <button type="button" className={styles.primary} onClick={() => { void navigator.clipboard.writeText(view.tentativa!.qrCode!).then(() => setCopied(true)).catch(() => setError("Selecione o código e copie manualmente.")); }}>Copiar código Pix</button>
      <p role="status">{copied ? "Código Pix copiado." : ""}</p>
      {view.tentativa.ticketUrl && <a className={styles.back} href={view.tentativa.ticketUrl} target="_blank" rel="noopener noreferrer">Ver instruções do Pix</a>}
    </div>}
    {paymentPolling && (polling.failed || view?.tentativa?.codigoErro || card && !!view?.tentativa) && <button type="button" className={styles.retry} disabled={busy} onClick={recoverPayment}>Consultar situação novamente</button>}
    {!cash && current.statusPagamento === "PENDENTE" && (view?.tentativa?.aguardando || uncertain) &&
      <p><a className={styles.back} href={`/checkout?pedido=${order.id}`}>Link para retomar este pagamento</a></p>}
    {canStart && pix && pixEnvironment === "test" && <button type="button" className={styles.primary} disabled={busy} onClick={() => void pay({ iniciarPix: true })}>Gerar Pix de teste</button>}
    {lastPayload && (!view?.tentativa || (view.tentativa.aguardando && view.tentativa.codigoErro)) && <button className={styles.primary} disabled={busy} onClick={() => void pay(lastPayload)}>Repetir mesma tentativa</button>}
    {canRetry && <button className={styles.primary} disabled={busy} onClick={newAttempt}>Tentar pagamento novamente</button>}
    {(cash || approved) && <button className={styles.primary} onClick={onFinish}>Concluir pedido</button>}
    <p className={styles.error} role="alert">{error}</p>
  </section>;
}
