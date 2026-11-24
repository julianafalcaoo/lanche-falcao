"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./checkout-page.module.css";

export function CardChallenge({ url, onComplete }: { url: string; onComplete: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const origin = new URL(url).origin;

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || event.data?.status !== "COMPLETE") return;
      setSubmitted(true);
      onComplete();
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [origin, onComplete]);

  return <section className={styles.payment} aria-labelledby="card-challenge-title">
    <h3 id="card-challenge-title">Autenticação do cartão</h3>
    <p role="status">{submitted
      ? "Autenticação enviada. Aguardando a confirmação do pagamento."
      : "Conclua a verificação do seu banco no quadro abaixo. Se precisar sair, retome este mesmo pagamento."}</p>
    <iframe ref={frame} className={styles.cardChallenge} title="Verificação 3DS do cartão" src={url}
      sandbox="allow-forms allow-scripts allow-same-origin" referrerPolicy="no-referrer" />
  </section>;
}
