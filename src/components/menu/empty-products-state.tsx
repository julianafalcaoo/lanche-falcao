import { Icon } from "@/components/ui/icon";
export function EmptyProductsState({ hasProducts, filtered, onClear }: { hasProducts: boolean; filtered: boolean; onClear: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={hasProducts ? "search" : "menu"} width={32} height={32} /></span>
    <h3>{hasProducts ? "Nenhum resultado por aqui" : "Nosso cardápio está sendo preparado"}</h3>
    <p>{hasProducts ? "Tente outro termo ou escolha uma categoria diferente." : "Assim que os produtos estiverem disponíveis, você poderá encontrá-los aqui."}</p>
    {filtered && <button type="button" className="text-button" onClick={onClear}>Limpar filtros <Icon name="arrow" width={18} /></button>}
  </div>;
}
