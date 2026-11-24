import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutPage } from "@/components/checkout/checkout-page";
import { DELIVERY_FEE_CENTS } from "@/server/pedidos/delivery";

export const metadata: Metadata = { title: "Checkout | Lanche Falcão" };
export default function Page() {
  return <Suspense fallback={<p role="status">Carregando checkout…</p>}>
    <CheckoutPage deliveryFeeCents={DELIVERY_FEE_CENTS} />
  </Suspense>;
}
