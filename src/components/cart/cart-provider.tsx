"use client";

import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import { products } from "@/data/menu";
import { CART_STORAGE_KEY, normalizeCart, parseCart, type CartItem } from "@/lib/cart";

interface CartState { items: CartItem[]; ready: boolean }
type Action =
  | { type: "restore"; items: CartItem[] }
  | { type: "add"; productId: string; quantity: number }
  | { type: "quantity"; productId: string; quantity: number }
  | { type: "remove"; productId: string }
  | { type: "clear" };

function reducer(state: CartState, action: Action): CartState {
  if (action.type === "restore") return { items: action.items, ready: true };
  if (!state.ready) return state;
  switch (action.type) {
    case "add":
      return { ...state, items: normalizeCart([...state.items, { productId: action.productId, quantity: action.quantity }]) };
    case "quantity":
      if (!Number.isSafeInteger(action.quantity) || action.quantity < 1) return state;
      return { ...state, items: normalizeCart(state.items.map((item) => item.productId === action.productId ? { ...item, quantity: action.quantity } : item)) };
    case "remove":
      return { ...state, items: state.items.filter((item) => item.productId !== action.productId) };
    case "clear":
      return { ...state, items: [] };
  }
}
interface CartContextValue extends CartState {
  totalQuantity: number;
  totalInCents: number;
  addItem: (productId: string, quantity: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
}
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [], ready: false });
  useEffect(() => {
    let items: CartItem[] = [];
    try { items = parseCart(window.localStorage.getItem(CART_STORAGE_KEY)); } catch { /* Storage may be unavailable. Keep the in-memory cart usable. */ }
    dispatch({ type: "restore", items });
  }, []);
  useEffect(() => {
    if (!state.ready) return;
    try { window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.items)); } catch { /* Browsing can continue without persistence. */ }
  }, [state.items, state.ready]);

  const totalQuantity = state.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalInCents = state.items.reduce((sum, item) => sum + (products.find((product) => product.id === item.productId)?.priceInCents ?? 0) * item.quantity, 0);
  return <CartContext.Provider value={{
    ...state, totalQuantity, totalInCents,
    addItem: (productId, quantity) => dispatch({ type: "add", productId, quantity }),
    setQuantity: (productId, quantity) => dispatch({ type: "quantity", productId, quantity }),
    removeItem: (productId) => dispatch({ type: "remove", productId }),
    clearCart: () => dispatch({ type: "clear" }),
  }}>{children}</CartContext.Provider>;
}
export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used within CartProvider");
  return cart;
}
