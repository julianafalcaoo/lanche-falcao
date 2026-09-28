import Link from "next/link";

export default function ProductNotFound() {
  return <main className="container product-detail-page">
    <div className="empty-state">
      <h1>Produto não encontrado</h1>
      <p>Não encontramos esse produto no cardápio.</p>
      <Link href="/#cardapio" className="primary-link">Voltar ao cardápio</Link>
    </div>
  </main>;
}
