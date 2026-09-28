import { Icon } from "@/components/ui/icon";
export function BottomNavigation() {
  return <nav className="bottom-navigation" aria-label="Navegação principal no celular">
    <a href="#inicio" aria-current="page"><Icon name="home" /><span>Início</span></a>
    <button type="button" onClick={() => document.getElementById("menu-search")?.focus()}><Icon name="search" /><span>Buscar</span></button>
    <button type="button" disabled aria-label="Carrinho — em breve"><Icon name="bag" /><span>Carrinho</span><small>Em breve</small></button>
    <button type="button" disabled aria-label="Perfil — em breve"><Icon name="user" /><span>Perfil</span><small>Em breve</small></button>
  </nav>;
}
