import type { Metadata } from "next";
import { CheckoutPage } from "@/components/checkout/checkout-page";

export const metadata: Metadata = { title: "Checkout | Lanche Falcão" };
export default function Page() { return <CheckoutPage />; }
