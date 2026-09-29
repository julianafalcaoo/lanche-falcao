import Link from "next/link";
import { products } from "@/data/menu";
import { useCart } from "@/components/cart/cart-provider";
import styles from "./checkout-page.module.css";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
export function OrderSummary({ delivery }: { delivery: boolean }) {
  const { items, totalInCents } = useCart();
  return <aside className={styles.panel} aria-labelledby="summary-title">
    <div className={styles.summaryHeading}><h2 id="summary-title">Resumo do pedido</h2><Link href="/carrinho">Editar carrinho</Link></div>
    <ul className={styles.items}>{items.map((item) => {
      const product = products.find((product) => product.id === item.productId);
      return product ? <li key={item.productId}><div><strong>{product.name}</strong><span>Quantidade: {item.quantity}</span></div><span>{money(product.priceInCents * item.quantity)}</span></li> : null;
    })}</ul>
    <dl className={styles.totals}><div><dt>Subtotal dos produtos</dt><dd>{money(totalInCents)}</dd></div><div className={styles.total}><dt>Total atual</dt><dd>{money(totalInCents)}</dd></div></dl>
    {delivery && <p className={styles.hint}>O total atual considera apenas os produtos. Os valores de entrega ainda serão definidos.</p>}
  </aside>;
}
