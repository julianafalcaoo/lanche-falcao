"use client";

import { useState } from "react";

interface ProductPurchaseProps {
  productId: string;
  priceInCents: number;
  onAdd?: (selection: { productId: string; quantity: number }) => void;
}

export function ProductPurchase({ productId, priceInCents, onAdd }: ProductPurchaseProps) {
  const [quantity, setQuantity] = useState(1);
  const subtotalInCents = priceInCents * quantity;
  const maxQuantity = Math.floor(Number.MAX_SAFE_INTEGER / priceInCents);

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
      <button type="button" className="product-add" disabled={!onAdd} aria-describedby={!onAdd ? "cart-notice" : undefined} onClick={() => onAdd?.({ productId, quantity })}>Adicionar ao carrinho</button>
      <button type="button" className="product-cart" disabled aria-describedby="cart-notice">Ir para o carrinho</button>
    </div>
    <p id="cart-notice" className="cart-notice">Carrinho em breve.</p>
  </div>;
}
