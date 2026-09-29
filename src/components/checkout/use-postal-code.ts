"use client";

import { useEffect, useRef, useState } from "react";
import type { DeliveryAddress } from "@/types/checkout";

type LookupField = "street" | "neighborhood" | "city" | "state";
export function usePostalCode(address: DeliveryAddress, onChange: (field: keyof DeliveryAddress, value: string) => void) {
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(false);
  const request = useRef<AbortController | null>(null);
  const lastCode = useRef("");
  const edited = useRef(new Set<keyof DeliveryAddress>());
  useEffect(() => () => request.current?.abort(), []);

  function change(field: keyof DeliveryAddress, value: string) {
    edited.current.add(field);
    if (field === "postalCode") {
      const digits = value.replace(/\D/g, "").slice(0, 8);
      value = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
      if (digits !== address.postalCode.replace(/\D/g, "")) {
        request.current?.abort();
        lastCode.current = "";
        setStatus("");
        setRetry(false);
        // A restored or manually edited address also belongs to the previous CEP.
        for (const key of ["street", "neighborhood", "city", "state"] as const) onChange(key, "");
      }
    }
    if (field === "state") value = value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 2);
    onChange(field, value);
  }

  async function lookup(force = false) {
    const code = address.postalCode.replace(/\D/g, "");
    if (!/^\d{8}$/.test(code) || (!force && lastCode.current === code)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    lastCode.current = code;
    edited.current.clear();
    setRetry(false);
    setStatus("Buscando endereço...");
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${code}/json/`, { signal: controller.signal });
      if (!response.ok) throw new Error("Postal lookup failed");
      const data: unknown = await response.json();
      if (controller.signal.aborted || request.current !== controller) return;
      if (!data || typeof data !== "object") throw new Error("Invalid postal response");
      if (Reflect.get(data, "erro") === true || Reflect.get(data, "erro") === "true") {
        setStatus("CEP não encontrado. Verifique o número informado.");
        return;
      }
      const mappings = { street: "logradouro", neighborhood: "bairro", city: "localidade", state: "uf" } as const;
      if (!Object.values(mappings).every((key) => typeof Reflect.get(data, key) === "string")) throw new Error("Invalid postal response");
      for (const key of Object.keys(mappings) as LookupField[]) {
        const value = (Reflect.get(data, mappings[key]) as string).slice(0, key === "state" ? 2 : 200);
        if (!edited.current.has(key)) {
          onChange(key, value);
        }
      }
      setStatus("Consulta concluída. Confira o endereço e preencha os campos que faltarem.");
    } catch {
      if (request.current !== controller || (controller.signal.aborted && !timedOut)) return;
      setStatus("Não foi possível consultar o CEP automaticamente. Preencha o endereço manualmente.");
      setRetry(true);
    } finally { window.clearTimeout(timer); }
  }
  return { status, retry, change, lookup };
}
