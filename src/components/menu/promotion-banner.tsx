import type { Promotion } from "@/types/menu";
export function PromotionBanner({ promotion }: { promotion?: Promotion }) {
  if (!promotion) return null;
  return <section className="promotion-banner" aria-label="Destaque promocional"><span className="eyebrow">Em destaque</span><h2>{promotion.title}</h2><p>{promotion.description}</p></section>;
}
