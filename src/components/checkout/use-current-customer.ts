"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { customerRequest, loadCustomer, type CurrentCustomer } from "./customer-api";

type SessionState = { status: "checking" | "guest" | "error"; customer: null } |
  { status: "authenticated"; customer: CurrentCustomer };

export function useCurrentCustomer() {
  const [state, setState] = useState<SessionState>({ status: "checking", customer: null });
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const logoutLock = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    void loadCustomer(AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])).then((customer) => {
      if (!controller.signal.aborted && version === generation.current) setState(customer ? { status: "authenticated", customer } : { status: "guest", customer: null });
    }).catch(() => {
      if (!controller.signal.aborted && version === generation.current) setState({ status: "error", customer: null });
    });
    return () => { controller.abort(); };
  }, []);

  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setState({ status: "checking", customer: null });
    try {
      const customer = await loadCustomer();
      if (version === generation.current) setState(customer ? { status: "authenticated", customer } : { status: "guest", customer: null });
      return customer;
    } catch {
      if (version === generation.current) setState({ status: "error", customer: null });
      return null;
    }
  }, []);

  async function signOut() {
    if (logoutLock.current) return;
    logoutLock.current = true;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await customerRequest("logout", {});
      generation.current++;
      setState({ status: "guest", customer: null });
    } catch {
      setLogoutError("Não foi possível sair agora. Tente novamente.");
    } finally { logoutLock.current = false; setLoggingOut(false); }
  }

  return { ...state, refresh, signOut, loggingOut, logoutError };
}
