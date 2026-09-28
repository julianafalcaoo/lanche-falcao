import { Icon } from "@/components/ui/icon";
export function SearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <form role="search" className="search-bar" onSubmit={(event) => event.preventDefault()}>
    <label htmlFor="menu-search" className="sr-only">Buscar no cardápio</label><Icon name="search" />
    <input id="menu-search" type="search" placeholder="O que você procura hoje?" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
    {value && <button type="button" aria-label="Limpar pesquisa" onClick={() => onChange("")}><Icon name="close" /></button>}
  </form>;
}
