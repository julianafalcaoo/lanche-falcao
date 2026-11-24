"use client";

import { useEffect, useRef, useState } from "react";
import { CheckoutRequestError } from "./payment-api";

export function usePaymentPolling(enabled: boolean, check: (signal: AbortSignal) => Promise<boolean>, immediate = false) {
  const [failure, setFailure] = useState<"network" | "access" | null>(null);
  const refresh = useRef<() => void>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    let requested = false;
    let stopped = false;
    let failures = 0;
    let successfulChecks = 0;

    function schedule(delay: number) {
      clearTimeout(timer);
      if (!document.hidden && !stopped && !controller.signal.aborted) timer = setTimeout(run, delay);
    }

    async function run() {
      clearTimeout(timer);
      if (document.hidden || stopped || controller.signal.aborted) return;
      if (running) { requested = true; return; }
      running = true;
      try {
        stopped = !await check(controller.signal);
        if (!controller.signal.aborted) setFailure(null);
        failures = 0;
        successfulChecks++;
      } catch (error) {
        if (controller.signal.aborted) return;
        failures++;
        stopped = error instanceof CheckoutRequestError && [401, 403, 404].includes(error.status);
        setFailure(stopped ? "access" : "network");
      } finally {
        running = false;
        const regularDelay = successfulChecks >= 24 ? 15000 : 5000;
        const delay = requested ? 0 : Math.min(regularDelay * 2 ** failures, 60000);
        requested = false;
        schedule(delay);
      }
    }

    function visibility() {
      if (document.hidden) clearTimeout(timer);
      else void run();
    }

    refresh.current = () => void run();
    document.addEventListener("visibilitychange", visibility);
    schedule(immediate ? 0 : 5000);
    return () => {
      refresh.current = null;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, check, immediate]);

  return { failed: failure === "network", accessDenied: failure === "access", refresh: () => refresh.current?.() };
}
