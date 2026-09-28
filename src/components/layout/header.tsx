import Image from "next/image";
import { SearchBar } from "@/components/menu/search-bar";
import { Icon } from "@/components/ui/icon";
export function Header({ search, onSearch }: { search: string; onSearch: (value: string) => void }) {
  return <header className="site-header" id="inicio"><div className="container header-inner">
    <a href="#inicio" className="brand">  <Image src="/images/logo-lanche-falcao.png" alt="Lanche Falcão" width={100} height={71} priority /></a>
    <SearchBar value={search} onChange={onSearch} />
    <nav className="header-actions" aria-label="Navegação principal">
      <a href="#cardapio" className="menu-link" aria-current="page">Cardápio</a>
      <button type="button" disabled aria-label="Perfil" title="Perfil"><Icon name="user" /><span>Perfil</span></button>
      <button type="button" className="cart-button" disabled aria-label="Carrinho" title="Carrinho"><Icon name="bag" /><span>Carrinho</span></button>
    </nav>
  </div></header>;
}
