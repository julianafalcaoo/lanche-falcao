import type { PaymentDraft } from "@/lib/payment";
import styles from "./checkout-page.module.css";

export function PaymentOptions({ payment, onChange, error }: { payment: PaymentDraft; onChange: (value: PaymentDraft) => void; error: string }) {
  return <fieldset className={`${styles.orderType} ${styles.payment}`} aria-describedby={error ? "payment-error" : undefined}>
    <legend>Forma de pagamento</legend>
    <div className={styles.options}>
      {([{ value: "PIX", label: "PIX" }, { value: "DINHEIRO", label: "Dinheiro" }, { value: "CARTAO", label: "Cartão" }] as const).map(({ value, label }) => <label className={styles.option} key={value}>
        <input type="radio" name="formaPagamento" value={value} checked={payment.formaPagamento === value} onChange={() => onChange({ formaPagamento: value, precisaTroco: false, trocoValor: "" })} />{label}
      </label>)}
    </div>
    {payment.formaPagamento === "PIX" && <p className={styles.hint}>Ao finalizar, use o QR Code ou o código Pix para pagar.</p>}
    {payment.formaPagamento === "CARTAO" && <p className={styles.hint}>Ao finalizar, informe seu cartão no formulário de pagamento.</p>}
    {payment.formaPagamento === "DINHEIRO" && <>
      <p className={styles.hint}>Pagamento no recebimento/retirada.</p>
      <fieldset className={`${styles.orderType} ${styles.payment}`}>
        <legend>Precisa de troco?</legend>
        <div className={styles.options}>{[false, true].map((value) => <label className={styles.option} key={String(value)}>
          <input type="radio" name="precisaTroco" checked={payment.precisaTroco === value} onChange={() => onChange({ ...payment, precisaTroco: value, trocoValor: "" })} />{value ? "Sim" : "Não"}
        </label>)}</div>
      </fieldset>
      {payment.precisaTroco && <div className={`${styles.field} ${styles.payment}`}>
        <label htmlFor="troco-valor">Troco para quanto?</label>
        <input id="troco-valor" name="trocoValor" type="text" inputMode="decimal" placeholder="Ex.: 20,00" maxLength={20} value={payment.trocoValor} onChange={(event) => onChange({ ...payment, trocoValor: event.target.value })} aria-invalid={Boolean(error)} aria-describedby={error ? "troco-hint payment-error" : "troco-hint"} />
        <p id="troco-hint" className={styles.hint}>Valor em reais (R$), maior ou igual ao total do pedido.</p>
      </div>}
    </>}
    <p id="payment-error" className={styles.error} aria-live="polite">{error}</p>
  </fieldset>;
}
