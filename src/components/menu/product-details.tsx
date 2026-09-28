import Image from "next/image";
import type { Product } from "@/types/menu";
import { Icon } from "@/components/ui/icon";
import { ProductPurchase } from "./product-purchase";

export function ProductDetails({ product, heading = "h1" }: { product: Product; heading?: "h1" | "h2" }) {
  const Heading = heading;
  return <article className="product-detail" aria-labelledby="product-title">
    <div className="product-detail-image">
      {product.image
        ? <Image src={product.image.src} alt={product.image.alt} fill sizes="(min-width: 768px) 240px, calc(100vw - 64px)" />
        : <span className="image-placeholder"><Icon name="menu" />Imagem indisponível</span>}
    </div>
    <div className="product-detail-info">
      <span className="eyebrow">LANCHE FALCÃO</span>
      <Heading id="product-title">{product.name}</Heading>
      <p className="product-detail-price">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.priceInCents / 100)}</p>
      <p className="product-detail-description">{product.description}</p>
      <ProductPurchase key={product.id} productId={product.id} priceInCents={product.priceInCents} />
    </div>
  </article>;
}
