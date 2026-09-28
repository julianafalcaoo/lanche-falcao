export interface Category { id: string; name: string; }
export interface Product {
  id: string;
  name: string;
  description: string;
  priceInCents: number;
  categoryId: Category["id"];
  dough?: "trigo" | "macaxeira";
  image?: { src: string; alt: string };
}
export interface Promotion { title: string; description: string; }
export interface MenuHomeProps {
  products: readonly Product[];
  categories: readonly Category[];
  promotion?: Promotion;
  whatsappNumber?: string;
}
