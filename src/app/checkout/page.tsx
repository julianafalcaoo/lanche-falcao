import type { Metadata } from "next";
import { connection } from "next/server";
import { CheckoutPage } from "@/components/checkout/checkout-page";

export const metadata: Metadata = { title: "Checkout | Lanche Falcão" };
export default async function Page() {
  await connection();
  return <CheckoutPage cardAvailable={process.env.MERCADO_PAGO_AMBIENTE?.trim() === "test"} />;
}
