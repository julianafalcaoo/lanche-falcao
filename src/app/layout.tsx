import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "Lanche Falcão | Cardápio",
  description: "Explore o cardápio do Lanche Falcão.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
