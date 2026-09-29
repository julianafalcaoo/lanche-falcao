"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CustomerApiError, customerRequest, formatCellphone } from "./customer-api";
import { OtpVerification } from "./otp-verification";
import { useCurrentCustomer } from "./use-current-customer";
import styles from "./customer-identification.module.css";

type Session = ReturnType<typeof useCurrentCustomer>;

export function CustomerIdentification({ session }: { session: Session }) {
  return <section className={styles.section} aria-labelledby="customer-heading">
    <h2 id="customer-heading">Identificação</h2>
    {session.status === "checking" ? <p role="status" className={styles.hint}>Verificando sua identificação…</p> :
      session.status === "error" ? <><p role="alert" className={styles.error}>Não foi possível consultar sua identificação.</p><button type="button" className={styles.link} onClick={() => void session.refresh()}>Tentar novamente</button></> :
      session.status === "authenticated" ? <div className={styles.identified}>
        <p role="status">Cliente identificado</p><strong>Pedido para {session.customer.nome}</strong>
        <p>{formatCellphone(session.customer.telefone)}</p>
        <button className={styles.link} type="button" disabled={session.loggingOut} onClick={() => void session.signOut()}>{session.loggingOut ? "Saindo..." : "Sair"}</button>
        <p role="alert" className={styles.error}>{session.logoutError}</p>
      </div> : <IdentificationForm onAuthenticated={session.refresh} />}
  </section>;
}

function IdentificationForm({ onAuthenticated }: { onAuthenticated: () => Promise<unknown> }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [step, setStep] = useState<"identity" | "otp">("identity");
  const [desafioId, setDesafioId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<"name" | "phone" | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const visitedOtp = useRef(false);
  useEffect(() => {
    if (step === "otp") visitedOtp.current = true;
    else if (visitedOtp.current) { phoneInput.current?.focus(); visitedOtp.current = false; }
  }, [step]);
  useEffect(() => {
    if (!busy && fieldError === "name") nameInput.current?.focus();
    if (!busy && fieldError === "phone") phoneInput.current?.focus();
  }, [busy, fieldError]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (lock.current) return;
    setError(""); setFieldError(null);
    if (!nome.trim() || nome.trim().length > 100 || /[\x00-\x1f\x7f]/.test(nome)) {
      setError("Informe um nome de até 100 caracteres."); setFieldError("name"); nameInput.current?.focus(); return;
    }
    if (telefone.replace(/\D/g, "").length !== 11) {
      setError("Informe o celular com DDD e nove dígitos."); setFieldError("phone"); phoneInput.current?.focus(); return;
    }
    lock.current = true; setBusy("send");
    setDesafioId(null);
    try {
      const data = await customerRequest("otp/solicitar", { nome: nome.trim(), telefone });
      if (data?.enviado !== true || typeof data.desafioId !== "string" || !/^[a-f0-9]{64}$/.test(data.desafioId)) throw new CustomerApiError("INDISPONIVEL");
      setDesafioId(data.desafioId); setStep("otp");
    } catch (failure) {
      setError(failure instanceof CustomerApiError ? failure.message : "Não foi possível enviar o código.");
      if (failure instanceof CustomerApiError && failure.code === "TELEFONE_INVALIDO") { setFieldError("phone"); phoneInput.current?.focus(); }
      if (failure instanceof CustomerApiError && failure.code === "NOME_INVALIDO") { setFieldError("name"); nameInput.current?.focus(); }
    } finally { lock.current = false; setBusy(null); }
  }

  async function verify(codigo: string) {
    if (lock.current || !desafioId) return;
    lock.current = true; setBusy("verify"); setError("");
    try {
      const data = await customerRequest("otp/verificar", { desafioId, codigo });
      if (data?.verificado !== true || data.autenticado !== true) throw new CustomerApiError("INDISPONIVEL");
      setDesafioId(null);
      await onAuthenticated();
    } catch (failure) {
      setError(failure instanceof CustomerApiError ? failure.message : "Não foi possível verificar o código.");
      if (!(failure instanceof CustomerApiError) || !["CODIGO_INCORRETO", "CODIGO_INVALIDO", "LIMITE_EXCEDIDO"].includes(failure.code)) setDesafioId(null);
    } finally { lock.current = false; setBusy(null); }
  }

  if (step === "otp") return <OtpVerification busy={busy} canVerify={Boolean(desafioId)} error={error} onVerify={verify} onResend={() => void send()}
    onChangePhone={() => { setDesafioId(null); setStep("identity"); setError(""); setFieldError(null); }} />;
  return <form className={styles.form} onSubmit={send} noValidate>
    <h3>Identifique-se para continuar</h3>
    <p className={styles.hint}>Enviaremos um código de 4 dígitos por SMS para confirmar seu celular.</p>
    <label htmlFor="customer-name">Nome</label>
    <input ref={nameInput} id="customer-name" autoComplete="name" required maxLength={100} value={nome} disabled={Boolean(busy)}
      onChange={(event) => setNome(event.target.value)} aria-invalid={fieldError === "name"} aria-describedby="identity-error" />
    <label htmlFor="customer-phone">Celular</label>
    <input ref={phoneInput} id="customer-phone" type="tel" inputMode="tel" autoComplete="tel-national" required placeholder="(00) 00000-0000" value={telefone} disabled={Boolean(busy)}
      onChange={(event) => setTelefone(formatCellphone(event.target.value))} aria-invalid={fieldError === "phone"} aria-describedby="identity-error" />
    <p id="identity-error" className={styles.error} role="alert">{error}</p>
    <button className={styles.primary} type="submit" disabled={Boolean(busy)}>{busy ? "Enviando código..." : "Enviar código"}</button>
    <p role="status" className={styles.hint}>{busy ? "Solicitando seu código…" : ""}</p>
  </form>;
}
