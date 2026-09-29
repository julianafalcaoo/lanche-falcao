"use client";

import { useEffect, useReducer, type SetStateAction } from "react";
import type { DeliveryAddress, OrderType } from "@/types/checkout";

const STORAGE_KEY = "lanche-falcao:checkout";
const emptyAddress: DeliveryAddress = { postalCode: "", street: "", number: "", neighborhood: "", city: "", state: "", complement: "", reference: "" };
interface Draft { orderType: OrderType | null; address: DeliveryAddress }
interface State extends Draft { ready: boolean }
const emptyDraft: Draft = { orderType: null, address: emptyAddress };
function readDraft(): Draft {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || !("orderType" in value) || !("address" in value)) return emptyDraft;
    if (value.orderType !== null && value.orderType !== "pickup" && value.orderType !== "delivery") return emptyDraft;
    if (!value.address || typeof value.address !== "object") return emptyDraft;
    const address = { ...emptyAddress };
    for (const key of Object.keys(emptyAddress) as (keyof DeliveryAddress)[]) {
      const field = Reflect.get(value.address, key);
      if (typeof field !== "string" || field.length > (key === "postalCode" ? 9 : key === "state" ? 2 : 200)) return emptyDraft;
      address[key] = field;
    }
    return { orderType: value.orderType, address };
  } catch { return emptyDraft; }
}
type Action = { type: "restore"; draft: Draft } | { type: "orderType"; value: OrderType } | { type: "address"; value: SetStateAction<DeliveryAddress> };
function reducer(state: State, action: Action): State {
  if (action.type === "restore") return { ...action.draft, ready: true };
  if (action.type === "orderType") return { ...state, orderType: action.value };
  return { ...state, address: typeof action.value === "function" ? action.value(state.address) : action.value };
}
export function useCheckoutDraft() {
  const [state, dispatch] = useReducer(reducer, { ...emptyDraft, ready: false });
  useEffect(() => { dispatch({ type: "restore", draft: readDraft() }); }, []);
  useEffect(() => {
    if (!state.ready) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ orderType: state.orderType, address: state.address }));
    } catch { /* Keep the form usable when storage is unavailable. */ }
  }, [state]);
  return {
    ...state,
    setOrderType: (value: OrderType) => dispatch({ type: "orderType", value }),
    setAddress: (value: SetStateAction<DeliveryAddress>) => dispatch({ type: "address", value }),
  };
}
