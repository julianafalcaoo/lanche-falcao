import { test, expect } from "@playwright/test";
import { checkoutIntent } from "../../src/lib/checkout-intent";

const body = { tipo: "ENTREGA", formaPagamento: "PIX", itens: [{ productId: "b", quantity: 1 }, { productId: "a", quantity: 2 }], endereco: { postalCode: "69000-000", state: "am", street: " Rua A ", number: "1" } };
test("assinatura ignora ordenação, formatação de endereço e preços", () => {
  expect(checkoutIntent(body)).toBe(checkoutIntent({ ...body, itens: [...body.itens].reverse(), totalCentavos: 1, endereco: { ...body.endereco, postalCode: "69000000", state: "AM", street: "Rua A" } }));
});
test("assinatura distingue endereço, produtos, quantidades e troco", () => {
  for (const changed of [
    { ...body, endereco: { ...body.endereco, number: "2" } },
    { ...body, itens: [{ productId: "c", quantity: 1 }] },
    { ...body, itens: [{ productId: "b", quantity: 2 }, body.itens[1]] },
    { ...body, formaPagamento: "DINHEIRO", precisaTroco: true, trocoParaCentavos: 2000 },
  ]) expect(checkoutIntent(changed)).not.toBe(checkoutIntent(body));
  const cash = { ...body, formaPagamento: "DINHEIRO", precisaTroco: true, trocoParaCentavos: 2000 };
  expect(checkoutIntent(cash)).not.toBe(checkoutIntent({ ...cash, trocoParaCentavos: 5000 }));
});
test("retirada ignora endereço e armazenamento corrompido não derruba checkout", () => {
  expect(checkoutIntent({ ...body, tipo: "RETIRADA" })).toBe(checkoutIntent({ ...body, tipo: "RETIRADA", endereco: {} }));
  expect(checkoutIntent({ ...body, itens: [null] })).toBe("");
});
