import Link from "next/link";
import { notFound } from "next/navigation";
import { products } from "@/data/menu";
import { ProductDetails } from "@/components/menu/product-details";

export function generateStaticParams() {
  return products.map((product) => ({ id: product.id }));
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = products.find((item) => item.id === id);
  if (!product) notFound();

  return <main className="container product-detail-page">
    <Link href="/#cardapio" className="product-back"><span aria-hidden="true">←</span> Voltar ao cardápio</Link>
    <ProductDetails product={product} />
  </main>;
}
