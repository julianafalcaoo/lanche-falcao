"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./customer-identification.module.css";

export function OtpVerification({ busy, canVerify, error, onVerify, onResend, onChangePhone }: {
  busy: "send" | "verify" | null; canVerify: boolean; error: string;
  onVerify: (codigo: string) => Promise<void>; onResend: () => void; onChangePhone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { if (!busy && canVerify) input.current?.focus(); }, [busy, canVerify]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !canVerify) return;
    const code = input.current?.value ?? "";
    if (!/^[0-9]{4}$/.test(code)) { setInvalid(true); input.current?.focus(); return; }
    setInvalid(false);
    await onVerify(code);
    if (input.current) { input.current.value = ""; input.current.focus(); }
  }
  return <form onSubmit={submit} noValidate className={styles.form}>
    <h3>Digite o código</h3>
    <p className={styles.hint}>Enviamos um código de 4 dígitos por SMS para o celular informado.</p>
    <label htmlFor="customer-otp">Código de 4 dígitos</label>
    <input ref={input} id="customer-otp" className={styles.otp} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={4}
      disabled={Boolean(busy) || !canVerify} aria-invalid={invalid || Boolean(error)} aria-describedby="otp-error"
      onInput={(event) => { event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 4); setInvalid(false); }} />
    <p id="otp-error" className={styles.error} role="alert">{invalid ? "Digite os quatro números do código recebido." : error}</p>
    <button className={styles.primary} disabled={Boolean(busy) || !canVerify} type="submit">{busy === "verify" ? "Verificando..." : "Confirmar código"}</button>
    <div className={styles.actions}>
      <button type="button" disabled={Boolean(busy)} onClick={() => { if (input.current) input.current.value = ""; setInvalid(false); onResend(); }}>{busy === "send" ? "Enviando código..." : "Solicitar novo código"}</button>
      <button type="button" disabled={Boolean(busy)} onClick={onChangePhone}>Alterar celular</button>
    </div>
    <p role="status" className={styles.hint}>{busy === "verify" ? "Verificando seu código…" : busy === "send" ? "Solicitando um novo código…" : ""}</p>
  </form>;
}
