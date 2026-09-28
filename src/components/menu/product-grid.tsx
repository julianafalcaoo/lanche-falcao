import type { Category, Product } from "@/types/menu";
import { ProductCard } from "./product-card";
export function ProductGrid({ products, categories, onAdd }: { products: readonly Product[]; categories: readonly Category[]; onAdd?: (product: Product) => void }) {
  return <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} category={categories.find((category) => category.id === product.categoryId)} onAdd={onAdd} />)}</div>;
}
