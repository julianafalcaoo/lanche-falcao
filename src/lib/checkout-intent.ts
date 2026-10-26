/** Canonical purchase intent. Prices are deliberately excluded: the API owns them. */
export function checkoutIntent(body: Record<string, unknown>): string {
  const items = Array.isArray(body.itens) ? body.itens as { productId: string; quantity: number }[] : [];
  if (items.some(item => !item || typeof item.productId !== "string" || !Number.isSafeInteger(item.quantity))) return "";
  const address = body.endereco as Record<string, unknown> | undefined;
  return JSON.stringify({
    itens: items.map(({ productId, quantity }) => ({ productId, quantity })).sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0),
    tipo: body.tipo,
    endereco: body.tipo === "ENTREGA" ? Object.fromEntries(["postalCode", "street", "number", "neighborhood", "complement", "reference", "city", "state"].map(key => {
      let value = String(address?.[key] ?? "").trim();
      if (key === "postalCode") value = value.replace(/\D/g, "");
      if (key === "state") value = value.toUpperCase();
      return [key, value];
    })) : null,
    formaPagamento: body.formaPagamento,
    precisaTroco: body.formaPagamento === "DINHEIRO" ? Boolean(body.precisaTroco) : false,
    trocoParaCentavos: body.formaPagamento === "DINHEIRO" && body.precisaTroco ? body.trocoParaCentavos : null,
  });
}
