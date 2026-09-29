"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { useCart } from "./cart-provider";

export function CartLink({ className }: { className?: string }) {
  const { totalQuantity } = useCart();
  const pathname = usePathname();
  return <Link href="/carrinho" className={className} aria-current={pathname === "/carrinho" ? "page" : undefined} aria-label={`Carrinho, ${totalQuantity} ${totalQuantity === 1 ? "unidade" : "unidades"}`}>
    <span className="cart-icon"><Icon name="bag" />{totalQuantity > 0 && <span className="cart-badge" aria-hidden="true">{totalQuantity}</span>}</span>
    <span className="cart-link-label">Carrinho</span>
  </Link>;
}
