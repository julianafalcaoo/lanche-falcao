"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { CartLink } from "@/components/cart/cart-link";
export function BottomNavigation() {
  const isHome = usePathname() === "/";
  return <nav className="bottom-navigation" aria-label="Navegação principal no celular">
    <Link href="/#inicio" aria-current={isHome ? "page" : undefined}><Icon name="home" /><span>Início</span></Link>
    {isHome ? <button type="button" onClick={() => document.getElementById("menu-search")?.focus()}><Icon name="search" /><span>Buscar</span></button> : <Link href="/#menu-search"><Icon name="search" /><span>Buscar</span></Link>}
    <CartLink />
    <button type="button" disabled aria-label="Perfil — em breve"><Icon name="user" /><span>Perfil</span><small>Em breve</small></button>
  </nav>;
}
