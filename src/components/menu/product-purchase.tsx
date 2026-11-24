"use client";

import { useState } from "react";
import Link from "next/link";
import { useCart } from "@/components/cart/cart-provider";
import { MAX_CART_QUANTITY } from "@/lib/cart";

interface ProductPurchaseProps {
  productId: string;
  priceInCents: number;
}

export function ProductPurchase({ productId, priceInCents }: ProductPurchaseProps) {
  const { addItem, ready } = useCart();
  const [addedQuantity, setAddedQuantity] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const subtotalInCents = priceInCents * quantity;
  const maxQuantity = MAX_CART_QUANTITY;

  return <div className="product-purchase">
    <div className="quantity-row">
      <span id="quantity-label">Quantidade</span>
      <div className="quantity-control" role="group" aria-labelledby="quantity-label">
        <button type="button" aria-label="Diminuir quantidade" disabled={quantity === 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
        <output aria-live="polite" aria-label="Quantidade selecionada">{quantity}</output>
        <button type="button" aria-label="Aumentar quantidade" disabled={quantity >= maxQuantity} onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}>+</button>
      </div>
    </div>
    <div className="subtotal-row"><span>Subtotal</span><output aria-live="polite" aria-label="Subtotal">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(subtotalInCents / 100)}</output></div>
    <div className="product-actions">
      <button type="button" className="product-add" disabled={!ready} onClick={() => { addItem(productId, quantity); setAddedQuantity((value) => value + quantity); }}>Adicionar ao carrinho</button>
      <Link className="product-cart" href="/carrinho">Ir para o carrinho</Link>
    </div>
    <p className="cart-notice" role="status">{addedQuantity > 0 ? `${addedQuantity} ${addedQuantity === 1 ? "unidade adicionada" : "unidades adicionadas"} ao carrinho.` : ""}</p>
  </div>;
}
