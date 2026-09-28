"use client";
import { useState } from "react";
import Image from "next/image";
import type { MenuHomeProps } from "@/types/menu";
import { Header } from "@/components/layout/header";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { Icon } from "@/components/ui/icon";
import { CategoryFilter } from "./category-filter";
import { PromotionBanner } from "./promotion-banner";
import { ProductGrid } from "./product-grid";
import { ProductModal } from "./product-modal";
import { EmptyProductsState } from "./empty-products-state";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
export function MenuHome({ products, categories, promotion, whatsappNumber }: MenuHomeProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [openedProductId, setOpenedProductId] = useState<string | null>(null);
  const openedProduct = products.find((product) => product.id === openedProductId);
  const selectedCategory = categories.some((category) => category.id === categoryId) ? categoryId : null;
  const query = normalize(search);
  const visibleProducts = products.filter((product) => (selectedCategory === null || product.categoryId === selectedCategory || (selectedCategory === "sucos" && product.categoryId === "vitaminas")) && normalize(`${product.name} ${product.description}`).includes(query));
  const clearFilters = () => { setSearch(""); setCategoryId(null); };
  return <>
    <a href="#cardapio" className="skip-link">Pular para o cardápio</a><Header search={search} onSearch={setSearch} />
    <main className="container main-content">
      <section className="welcome-banner" aria-labelledby="welcome-title">
        <div className="welcome-copy"><span className="eyebrow"><span className="small-line" /> BEM-VINDO AO LANCHE FALCÃO</span><h1 id="welcome-title">Sua próxima pausa<br />tem <em>sabor.</em></h1><p>Fique à vontade. Explore nosso cardápio.</p><a href="#cardapio" className="primary-link">Ver cardápio <Icon name="arrow" width={19} /></a></div>
        <div className="welcome-art" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><Image src="/images/logo-lanche-falcao.png" alt="" width={400} height={285} sizes="(min-width: 768px) 360px, 150px" priority /><span className="art-caption"></span></div>
      </section>
      <PromotionBanner promotion={promotion} />
      <section id="cardapio" className="menu-section" aria-labelledby="menu-title" tabIndex={-1}>
        <div className="section-heading"><div><span className="eyebrow section-eyebrow">ESCOLHA DO SEU JEITO</span><h2 id="menu-title">Nosso cardápio<span className="title-dot">.</span></h2></div><span className="menu-note"><Icon name="menu" width={18} />Explore as opções</span></div>
        <CategoryFilter categories={categories} selected={selectedCategory} onSelect={setCategoryId} />
        <p className="sr-only" role="status" aria-live="polite">{visibleProducts.length} {visibleProducts.length === 1 ? "produto encontrado" : "produtos encontrados"}.</p>
        {visibleProducts.length ? <ProductGrid products={visibleProducts} categories={categories} onOpen={setOpenedProductId} /> : <EmptyProductsState hasProducts={products.length > 0} filtered={Boolean(search || selectedCategory)} onClear={clearFilters} />}
      </section>
      <footer className="site-footer"><span>Lanche <strong>Falcão</strong></span><p>Seu momento de fazer uma pausa.</p><a href="#inicio">Voltar ao início</a></footer>
    </main><WhatsAppButton phoneNumber={whatsappNumber} /><BottomNavigation />
    {openedProduct && <ProductModal key={openedProduct.id} product={openedProduct} onClose={() => setOpenedProductId(null)} />}
  </>;
}
