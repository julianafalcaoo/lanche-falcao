"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardData, CheckoutOrder, PaymentView } from "@/types/checkout-payment";
import { CardPayment } from "./card-payment";
import { checkoutRequest } from "./payment-api";
import styles from "./checkout-page.module.css";

export function PaymentStage({ order, onFinish }: { order: CheckoutOrder; onFinish: () => void }) {
  const [view, setView] = useState<PaymentView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const [lastPayload, setLastPayload] = useState<object | null>(null);
  const clientKey = useRef<string | null>(null);
  const api = `/api/pedidos/${order.id}/pagamento`;
  const pay = useCallback(async (body?: object) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (body) {
        const keyName = `lanche-falcao:payment-key:${order.id}`;
        clientKey.current ??= sessionStorage.getItem(keyName) ?? crypto.randomUUID();
        sessionStorage.setItem(keyName, clientKey.current);
        setLastPayload(body);
      }
      const data = await checkoutRequest<PaymentView>(api, body ?? { consultar: true }, body ? clientKey.current! : undefined);
      setView(data);
      if (data.tentativa && !data.tentativa.codigoErro) setLastPayload(null);
      if (data.tentativa?.codigoErro) setError(data.tentativa.podeTentarNovamente ? "O pagamento não foi iniciado. Tente novamente em instantes." : "Ainda não foi possível confirmar o pagamento. Verifique novamente ou repita esta tentativa.");
    } catch (failure) { setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "A resposta demorou. Verifique o pagamento antes de tentar novamente."); }
    finally { lock.current = false; setBusy(false); }
  }, [api, order.id]);
  useEffect(() => {
    let active = true;
    void checkoutRequest<PaymentView>(api).then(data => {
      if (!active) return;
      setView(data);
      if (data.pedido.formaPagamento === "PIX" && data.pedido.statusPagamento !== "APROVADO" && !data.tentativa) void pay({ iniciarPix: true });
    }).catch(() => { if (active) setError("Não foi possível consultar o pagamento. Tente verificar novamente."); });
    return () => { active = false; };
  }, [api, pay]);
  async function cardSubmit(data: CardData, paymentType: string) {
    // Lista explícita: nunca encaminha formData integral nem total informado pelo SDK.
    await pay({ payer: { email: data.payer.email, ...(data.payer.identification ? { identification: { type: data.payer.identification.type, number: data.payer.identification.number } } : {}) },
      card: { token: data.token, payment_method_id: data.payment_method_id, installments: data.installments, payment_type_id: paymentType } });
  }
  function newAttempt() {
    sessionStorage.removeItem(`lanche-falcao:payment-key:${order.id}`);
    clientKey.current = null; setLastPayload(null); setView(current => current ? { ...current, tentativa: null } : null); setError("");
    if (order.formaPagamento === "PIX") void pay({ iniciarPix: true });
  }
  const current = view?.pedido ?? order;
  const cash = current.formaPagamento === "DINHEIRO";
  const approved = current.statusPagamento === "APROVADO";
  const afterPaymentMessage = { ESTORNADO: "Pagamento estornado integralmente.", ESTORNADO_PARCIAL: "Pagamento estornado parcialmente.", CONTESTADO: "Pagamento em contestação. Entre em contato com a lanchonete." }[current.statusPagamento as "ESTORNADO" | "ESTORNADO_PARCIAL" | "CONTESTADO"];
  const canStart = view && !view.tentativa && !cash && !approved && !lastPayload;
  return <section className={styles.panel} aria-busy={busy}>
    <h2>{cash ? "Pedido confirmado" : current.formaPagamento === "PIX" ? "Pagamento via Pix" : "Pagamento com cartão"}</h2>
    <p className={styles.feedback}>Total: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(current.totalCentavos / 100)}</p>
    <p role="status">{cash ? "Pagamento em dinheiro no recebimento/retirada." : afterPaymentMessage ?? (approved ? "Pagamento aprovado." : current.statusPagamento === "RECUSADO" ? "Pagamento recusado." : current.statusPagamento === "CANCELADO" ? "Pagamento cancelado ou expirado." : "Aguardando confirmação do pagamento.")}</p>
    {canStart && current.formaPagamento === "CARTAO" && <CardPayment total={current.totalCentavos} onSubmit={cardSubmit} />}
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
    {!cash && !approved && <button type="button" className={styles.primary} disabled={busy} onClick={() => void pay(current.formaPagamento === "PIX" && !view?.tentativa ? { iniciarPix: true } : undefined)}>Verificar pagamento</button>}
    {lastPayload && (!view?.tentativa || (view.tentativa.aguardando && view.tentativa.codigoErro)) && <button className={styles.primary} disabled={busy} onClick={() => void pay(lastPayload)}>Repetir mesma tentativa</button>}
    {view?.tentativa?.podeTentarNovamente && <button className={styles.primary} disabled={busy} onClick={newAttempt}>Tentar pagamento novamente</button>}
    {(cash || approved) && <button className={styles.primary} onClick={onFinish}>Concluir pedido</button>}
    <p className={styles.error} role="alert">{error}</p>
  </section>;
}
