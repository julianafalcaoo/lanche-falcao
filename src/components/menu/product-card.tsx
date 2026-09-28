import Image from "next/image";
import { Icon } from "@/components/ui/icon";
import type { Category, Product } from "@/types/menu";
export function ProductCard({ product, category, onAdd }: { product: Product; category?: Category; onAdd?: (product: Product) => void }) {
  return <article className="product-card">
    <div className="product-image">{product.image ? <Image src={product.image.src} alt={product.image.alt} fill sizes="(min-width: 1200px) 280px, (min-width: 768px) 30vw, calc((100vw - 44px) / 2)" /> : <span className="image-placeholder"><Icon name="menu" />Imagem indisponível</span>}</div>
    <div className="product-content">{category && <span className="product-category">{category.name}</span>}<h3>{product.name}</h3><p>{product.description}</p>
      <div className="product-bottom"><strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.priceInCents / 100)}</strong><button type="button" disabled={!onAdd} onClick={() => onAdd?.(product)} aria-label={onAdd ? `Adicionar ${product.name}` : `Adicionar ${product.name} — em breve`} title={onAdd ? "Adicionar" : "Adicionar — em breve"}><Icon name="plus" /></button></div>
    </div>
  </article>;
}
