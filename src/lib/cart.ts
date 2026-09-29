import { products } from "@/data/menu";

export interface CartItem { productId: string; quantity: number }
export const CART_STORAGE_KEY = "lanche-falcao:cart";
// Numerical safety limit, not a stock or commercial limit.
export const MAX_CART_QUANTITY = Math.floor(Number.MAX_SAFE_INTEGER / products.reduce((sum, product) => sum + product.priceInCents, 0));
export function normalizeCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.productId !== "string" ||
      !products.some((product) => product.id === item.productId) ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1) continue;
    quantities.set(item.productId, Math.min(MAX_CART_QUANTITY, (quantities.get(item.productId) ?? 0) + item.quantity));
  }
  return Array.from(quantities, ([productId, quantity]) => ({ productId, quantity }));
}
export function parseCart(value: string | null): CartItem[] {
  try { return normalizeCart(value ? JSON.parse(value) : []); } catch { return []; }
}
