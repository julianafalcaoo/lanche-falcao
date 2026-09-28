import { MenuHome } from "@/components/menu/menu-home";
import { categories, products } from "@/data/menu";

export default function Home() {
  return <MenuHome products={products} categories={categories} />;
}
