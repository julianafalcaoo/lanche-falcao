import Image from "next/image";
import type { Category } from "@/types/menu";

const filterImages = [
  { id: "salgados-fritos", image: "salgados-fritos.jpg" },
  { id: "salgados-assados", image: "salgados-assados.jpg" },
  { id: "sucos", image: "sucos.jpg" },
  { id: "refrigerantes", image: "refri.jpg" },
];

export function CategoryFilter({ categories, selected, onSelect }: { categories: readonly Category[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const filters = [
    { id: null, name: "Tudo", image: "imagem-filtro-tudo.jpeg" },
    ...filterImages.flatMap(({ id, image }) => {
      const category = categories.find((item) => item.id === id);
      return category ? [{ ...category, image }] : [];
    }),
  ];

  return <div className="category-filter" role="group" aria-label="Filtrar por categoria">
    {filters.map((category) => <button
      type="button"
      key={category.image}
      aria-pressed={selected === category.id}
      onClick={() => onSelect(category.id)}
    >
      <span className="category-image">
        <Image src={`/images/categorias/${category.image}`} alt="" fill sizes="(min-width: 768px) 104px, 88px" />
      </span>
      <span className="category-label">{category.name}</span>
    </button>)}
  </div>;
}
