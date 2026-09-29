"use client";

import Image from "next/image";
import Link from "next/link";
import { products } from "@/data/menu";
import { MAX_CART_QUANTITY } from "@/lib/cart";
import { useCart } from "./cart-provider";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { Icon } from "@/components/ui/icon";
import styles from "./cart-page.module.css";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function CartPage() {
  const { items, ready, totalQuantity, totalInCents, setQuantity, removeItem, clearCart } = useCart();
  return <>
    <main className="container cart-page">
      <Link className="product-back" href="/#cardapio">← Continuar comprando</Link>
      <div className="cart-heading"><h1>Meu carrinho</h1>{ready && items.length > 0 && <button type="button" className="text-button" onClick={clearCart}>Limpar carrinho</button>}</div>
      <p className="sr-only" role="status">{ready ? `${totalQuantity} unidades no carrinho. Total ${money(totalInCents)}.` : "Carregando carrinho."}</p>
      {!ready ? <p role="status">Carregando carrinho…</p> : items.length === 0 ? <div className="empty-state">
        <span className="empty-icon"><Icon name="bag" width={32} height={32} /></span>
        <h2>Seu carrinho está vazio.</h2>
        <Link className="primary-link" href="/#cardapio">Ver cardápio</Link>
      </div> : <div className="cart-layout">
        <ul className="cart-items">
          {items.map((item) => {
            const product = products.find((product) => product.id === item.productId);
            if (!product) return null;
            return <li key={item.productId} className="cart-item">
              <div className="cart-item-image">{product.image ? <Image src={product.image.src} alt={product.image.alt} fill sizes="(min-width: 768px) 112px, 80px" /> : <span className="image-placeholder">Imagem indisponível</span>}</div>
              <div className="cart-item-info">
                <h2>{product.name}</h2>
                <p>{money(product.priceInCents)} por unidade</p>
              </div>
              <div className="cart-item-controls">
                <div className="quantity-control" role="group" aria-label={`Quantidade de ${product.name}`}>
                  <button type="button" aria-label={`Diminuir quantidade de ${product.name}`} disabled={item.quantity === 1} onClick={() => setQuantity(item.productId, item.quantity - 1)}>−</button>
                  <output aria-label={`Quantidade de ${product.name}`}>{item.quantity}</output>
                  <button type="button" aria-label={`Aumentar quantidade de ${product.name}`} disabled={item.quantity >= MAX_CART_QUANTITY} onClick={() => setQuantity(item.productId, item.quantity + 1)}>+</button>
                </div>
                <button type="button" className="cart-remove" aria-label={`Remover ${product.name}`} onClick={() => removeItem(item.productId)}>Remover</button>
              </div>
              <p className="cart-item-subtotal">Subtotal <strong>{money(product.priceInCents * item.quantity)}</strong></p>
            </li>;
          })}
        </ul>
        <aside className="cart-summary" aria-labelledby="cart-summary-title">
          <h2 id="cart-summary-title">Resumo do pedido</h2>
          <dl><div><dt>Subtotal</dt><dd>{money(totalInCents)}</dd></div><div className="cart-total"><dt>Total</dt><dd>{money(totalInCents)}</dd></div></dl>
          <Link href="/checkout" className={styles.continueLink}>Continuar pedido</Link>
        </aside>
      </div>}
    </main>
    <BottomNavigation />
  </>;
}
