import { test, expect, type Page } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const qr = "pix-retornado-pelo-provedor-no-teste";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XkAAAAASUVORK5CYII=";
async function setup(page: Page, production = false) {
  let currentId = id;
  let total = 800;
  const orders = new Map<string, { id: string; body: Record<string, unknown> }>();
  const requests: { path: string; body: Record<string, unknown>; key: string | undefined }[] = [];
  let method = "PIX", status = "PENDENTE", hasAttempt = false, failOrder = false, failPayment = false, cardRejected = false;
  let pause: Promise<void> | undefined;
  await page.addInitScript(() => {
    if (!localStorage.getItem("lanche-falcao:cart")) localStorage.setItem("lanche-falcao:cart", JSON.stringify([{ productId: "coxinha-frango", quantity: 2 }]));
    if (!sessionStorage.getItem("lanche-falcao:checkout")) sessionStorage.setItem("lanche-falcao:checkout", JSON.stringify({ orderType: "pickup", address: { postalCode: "", street: "", number: "", neighborhood: "", city: "", state: "", complement: "", reference: "" } }));
  });
  const order = () => ({ id: currentId, formaPagamento: method, statusPagamento: status, totalCentavos: total });
  const view = () => ({ pedido: order(), tentativa: hasAttempt ? { id: "attempt", statusExterno: status === "APROVADO" ? "processed" : status === "RECUSADO" ? "failed" : "action_required", detalheExterno: status === "APROVADO" ? "accredited" : "waiting_transfer", codigoErro: null, podeTentarNovamente: status === "RECUSADO", aguardando: status === "PENDENTE", qrCode: method === "PIX" && status === "PENDENTE" ? (currentId === id ? qr : `${qr}-${currentId}`) : null, qrCodeBase64: png, ticketUrl: null } : null });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.href === "https://sdk.mercadopago.com/js/v2") return route.fulfill({ contentType: "application/javascript", body: `
      window.MercadoPago = class {
        bricks() { return { create: async (type, id, settings) => {
          if (settings.initialization.payer && settings.initialization.payer.email !== "test@testuser.com") throw new Error("Unexpected email initialization");
          const root = document.getElementById(id);
          const email = document.createElement("input"); email.type = "email"; email.required = true; email.setAttribute("aria-label", "E-mail do cartão");
          if (!settings.initialization.payer) root.append(email);
          const button = document.createElement("button"); button.type = "button"; button.textContent = "Pagar com cartão de teste";
          button.onclick = () => {
            if (!settings.initialization.payer && !email.reportValidity()) return;
            return settings.callbacks.onSubmit({ token: "mock_token_123456789", payment_method_id: "visa", installments: 1, transaction_amount: 0.01, card_number: "SHOULD_NOT_FORWARD", payer: { email: settings.initialization.payer?.email ?? email.value, identification: { type: "CPF", number: "12345678909" } } }, { paymentTypeId: "credit_card" });
          };
          root.append(button); settings.callbacks.onReady();
          return { unmount: async () => root.replaceChildren() };
        } }; }
      };
    ` });
    if (url.origin !== "http://127.0.0.1:3100") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { autenticado: true, cliente: { nome: "Cliente teste", telefone: "+5592999999999" } } });
    if (url.pathname === "/api/pagamentos/config") return route.fulfill({ json: { publicKey: "mock-public", ambiente: production ? "production" : "test", payerEmail: production ? null : "test@testuser.com" } });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      requests.push({ path: url.pathname, body, key: route.request().headers()["idempotency-key"] });
      if (url.pathname === "/api/pedidos") {
        method = body.formaPagamento;
        await pause;
        if (failOrder) { failOrder = false; return route.abort(); }
        const key = route.request().headers()["idempotency-key"];
        if (!orders.has(key)) {
          currentId = orders.size ? `22222222-2222-4222-8222-${String(orders.size).padStart(12, "0")}` : id;
          orders.set(key, { id: currentId, body: structuredClone(body) });
          total = body.itens.reduce((sum: number, item: { quantity: number }) => sum + item.quantity * 400, 0);
          hasAttempt = false; status = "PENDENTE";
        } else currentId = orders.get(key)!.id;
        return route.fulfill({ status: 201, json: { pedido: order() } });
      }
      if (url.pathname.endsWith("/pagamento")) {
        if (failPayment) { failPayment = false; return route.abort(); }
        hasAttempt = true;
        if (method === "CARTAO" && !body.consultar) status = cardRejected ? "RECUSADO" : "APROVADO";
        return route.fulfill({ json: view() });
      }
    }
    if (url.pathname === `/api/pedidos/${currentId}`) return route.fulfill({ json: { pedido: order() } });
    if (url.pathname.endsWith("/pagamento")) return route.fulfill({ json: view() });
    return route.abort();
  });
  return { requests, approve: () => { status = "APROVADO"; }, pause: (value: Promise<void>) => { pause = value; }, failOrder: () => { failOrder = true; }, failPayment: () => { failPayment = true; }, rejectCard: (value: boolean) => { cardRejected = value; } };
}
async function begin(page: Page, method: string) {
  await page.goto("/checkout");
  await page.getByRole("radio", { name: method, exact: true }).check();
  await page.getByRole("button", { name: "Finalizar pedido", exact: true }).click();
}
test("Pix de produção solicita e-mail e não gera cobrança automaticamente", async ({ page }) => {
  const api = await setup(page, true);
  await begin(page, "PIX");
  await expect(page.getByLabel("E-mail do comprador")).toBeVisible();
  expect(api.requests.filter(request => request.path.endsWith("/pagamento"))).toHaveLength(0);
  await page.getByRole("button", { name: "Gerar Pix", exact: true }).click();
  expect(api.requests.filter(request => request.path.endsWith("/pagamento"))).toHaveLength(0);
  await page.getByLabel("E-mail do comprador").fill("comprador@dominio.com.br");
  await page.getByRole("button", { name: "Gerar Pix", exact: true }).click();
  await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).toHaveValue(qr);
  expect(api.requests.filter(request => request.path.endsWith("/pagamento"))[0].body).toEqual({ payer: { email: "comprador@dominio.com.br" } });
  await expect(page.getByRole("button", { name: "Concluir pedido", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).toHaveValue(qr);
  expect(api.requests.filter(request => request.path.endsWith("/pagamento"))).toHaveLength(1);
});
test("cartão de produção solicita e-mail no Brick sem preencher fixture", async ({ page }) => {
  const api = await setup(page, true);
  await begin(page, "Cartão");
  await page.getByLabel("E-mail do cartão").fill("comprador@dominio.com.br");
  await page.getByRole("button", { name: "Pagar com cartão de teste" }).click();
  await expect(page.getByText("Pagamento aprovado.", { exact: true })).toBeVisible();
  const body = api.requests.find(request => request.path.endsWith("/pagamento"))!.body;
  expect(body).toMatchObject({ payer: { email: "comprador@dominio.com.br" } });
  expect(body).not.toHaveProperty("card_number");
  expect(body).not.toHaveProperty("transaction_amount");
});
for (const change of ["quantity", "replace", "payment", "change", "delivery"] as const) {
  test(`nova intenção (${change}) exige finalizar novamente e preserva pedido anterior`, async ({ page }) => {
    const api = await setup(page);
    await begin(page, change === "change" ? "Dinheiro" : "PIX");
    await expect(page.getByRole("heading", { name: change === "change" ? "Pedido criado" : "Pagamento via Pix", exact: true })).toBeVisible();
    if (change !== "change") await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).toHaveValue(qr);
    const original = structuredClone(api.requests.find(request => request.path === "/api/pedidos")!);
    await page.evaluate(change => {
      if (change === "quantity") localStorage.setItem("lanche-falcao:cart", JSON.stringify([{ productId: "coxinha-frango", quantity: 3 }]));
      if (change === "replace") {
        localStorage.setItem("lanche-falcao:cart", "[]");
        localStorage.setItem("lanche-falcao:cart", JSON.stringify([{ productId: "esfirra-carne", quantity: 1 }]));
      }
      const draft = JSON.parse(sessionStorage.getItem("lanche-falcao:checkout")!);
      if (change === "payment") draft.formaPagamento = "DINHEIRO";
      if (change === "change") { draft.precisaTroco = true; draft.trocoValor = "20,00"; }
      if (change === "delivery") { draft.orderType = "delivery"; draft.address = { postalCode: "69000000", street: "Rua A", number: "10", neighborhood: "Centro", city: "Manaus", state: "AM", complement: "", reference: "" }; }
      sessionStorage.setItem("lanche-falcao:checkout", JSON.stringify(draft));
    }, change);
    await page.reload();
    await expect(page.getByRole("button", { name: "Finalizar pedido", exact: true })).toBeVisible();
    await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).toHaveCount(0);
    expect(api.requests.filter(request => request.path === "/api/pedidos")).toHaveLength(1);
    await page.getByRole("button", { name: "Finalizar pedido", exact: true }).click();
    await expect.poll(() => api.requests.filter(request => request.path === "/api/pedidos").length).toBe(2);
    const orders = api.requests.filter(request => request.path === "/api/pedidos");
    expect(orders[0]).toEqual(original);
    expect(orders[1].key).not.toBe(original.key);
    if (!["payment", "change"].includes(change)) {
      await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).not.toHaveValue(qr);
      await expect.poll(() => api.requests.filter(request => request.path.endsWith("/pagamento")).length).toBe(2);
      const payments = api.requests.filter(request => request.path.endsWith("/pagamento"));
      expect(payments[0].path).not.toBe(payments[1].path);
      expect(payments[0].key).not.toBe(payments[1].key);
      if (change === "quantity") await expect(page.getByText(/Total: R\$\s*12,00/)).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole("button", { name: "Finalizar pedido", exact: true })).toHaveCount(0);
    expect(api.requests.filter(request => request.path === "/api/pedidos")).toHaveLength(2);
  });
}
test("dinheiro confirma pedido, preserva troco e só limpa carrinho ao concluir", async ({ page }) => {
  const api = await setup(page);
  await page.goto("/checkout");
  await page.getByRole("radio", { name: "Dinheiro", exact: true }).check();
  await page.getByRole("radio", { name: "Sim", exact: true }).check();
  await page.getByLabel("Troco para quanto?").fill("20,00");
  await page.getByRole("button", { name: "Finalizar pedido", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pedido criado", exact: true })).toBeVisible();
  expect(api.requests).toHaveLength(1);
  expect(api.requests[0].body).toMatchObject({ formaPagamento: "DINHEIRO", precisaTroco: true, trocoParaCentavos: 2000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("lanche-falcao:cart")!))).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pedido criado", exact: true })).toBeVisible();
  expect(api.requests).toHaveLength(1);
  await page.getByRole("button", { name: "Concluir pedido", exact: true }).click();
  await expect(page.getByText("Seu carrinho está vazio.")).toBeVisible();
});
for (const width of [320, 375, 430, 768, 1024, 1440]) {
  test(`PIX, cópia, reload e confirmação em ${width}px`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 900 });
    const api = await setup(page);
    await begin(page, "PIX");
    await expect(page.getByLabel("E-mail de teste do pagador")).toHaveCount(0);
    await expect(page.getByLabel("Nome do cenário de teste (opcional)")).toHaveCount(0);
    await expect(page.getByText(/ambiente de teste/i)).toHaveCount(0);
    await expect(page.getByText(id, { exact: false })).toHaveCount(0);
    await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).toHaveValue(qr);
    await expect(page.getByRole("img", { name: "QR Code Pix do pedido" })).toBeVisible();
    await page.getByRole("button", { name: "Copiar código Pix" }).click();
    await expect(page.getByText("Código Pix copiado.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(qr);
    await expect(page.getByText("Aguardando confirmação do pagamento.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).toHaveValue(qr);
    expect(api.requests.filter(request => request.path === "/api/pedidos")).toHaveLength(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("lanche-falcao:cart")!))).toHaveLength(1);
    api.approve();
    await page.getByRole("button", { name: "Verificar pagamento" }).click();
    await expect(page.getByText("Pagamento aprovado.")).toBeVisible();
    await page.getByRole("button", { name: "Concluir pedido", exact: true }).click();
    await expect(page.getByText("Seu carrinho está vazio.")).toBeVisible();
  });
}
test("duplo clique e falha da criação recuperam mesma chave após reload", async ({ page }) => {
  const api = await setup(page);
  api.failOrder();
  let release!: () => void;
  api.pause(new Promise<void>(resolve => { release = resolve; }));
  await page.goto("/checkout");
  await page.getByRole("radio", { name: "PIX", exact: true }).check();
  await page.getByRole("button", { name: "Finalizar pedido", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => api.requests.length).toBe(1);
  release();
  await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pagamento via Pix" })).toBeVisible();
  expect(api.requests.filter(request => request.path === "/api/pedidos")).toHaveLength(2);
  expect(api.requests[0].key).toBe(api.requests[1].key);
  expect(api.requests[0].body).toEqual(api.requests[1].body);
});
test("Brick transmite token permitido, trata recusa e tenta novamente no mesmo Pedido", async ({ page }) => {
  const api = await setup(page);
  api.rejectCard(true);
  await begin(page, "Cartão");
  await page.getByRole("button", { name: "Pagar com cartão de teste" }).click();
  await expect(page.getByText("Pagamento recusado.")).toBeVisible();
  const first = api.requests.find(request => request.path.endsWith("/pagamento"))!;
  expect(first.body).toMatchObject({ card: { token: "mock_token_123456789", payment_type_id: "credit_card" } });
  expect(JSON.stringify(first.body)).not.toContain("SHOULD_NOT_FORWARD");
  expect(JSON.stringify(first.body)).not.toContain("transaction_amount");
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain("mock_token");
  api.rejectCard(false);
  await page.getByRole("button", { name: "Tentar pagamento novamente" }).click();
  await page.getByRole("button", { name: "Pagar com cartão de teste" }).click();
  await expect(page.getByText("Pagamento aprovado.")).toBeVisible();
  expect(api.requests.filter(request => request.path === "/api/pedidos")).toHaveLength(1);
  const payments = api.requests.filter(request => request.path.endsWith("/pagamento"));
  expect(payments[0].key).not.toBe(payments[1].key);
});
test("itens adicionados depois da confirmação não são apagados", async ({ page }) => {
  await setup(page);
  await begin(page, "Dinheiro");
  await expect(page.getByRole("heading", { name: "Pedido criado", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("lanche-falcao:cart", JSON.stringify([{ productId: "coxinha-frango", quantity: 3 }])));
  await page.getByRole("button", { name: "Concluir pedido", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("lanche-falcao:cart")!)[0].quantity)).toBe(3);
});

test("falha de rede no pagamento permite repetir o mesmo token/chave sem novo Pedido", async ({ page }) => {
  const api = await setup(page);
  api.failPayment();
  await begin(page, "Cartão");
  await page.getByRole("button", { name: "Pagar com cartão de teste" }).click();
  await expect(page.getByRole("button", { name: "Repetir mesma tentativa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar com cartão de teste" })).toHaveCount(0);
  await page.getByRole("button", { name: "Repetir mesma tentativa" }).click();
  await expect(page.getByText("Pagamento aprovado.")).toBeVisible();
  const calls = api.requests.filter(request => request.path.endsWith("/pagamento"));
  expect(calls).toHaveLength(2);
  expect(calls[0].key).toBe(calls[1].key);
  expect(calls[0].body).toEqual(calls[1].body);
});

test("Pix automático com resposta perdida não inventa QR e repete a mesma chave", async ({ page }) => {
  const api = await setup(page);
  api.failPayment();
  await begin(page, "PIX");
  await expect(page.getByRole("button", { name: "Repetir mesma tentativa" })).toBeVisible();
  await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("lanche-falcao:cart")!))).toHaveLength(1);
  await page.getByRole("button", { name: "Repetir mesma tentativa" }).click();
  await expect(page.getByLabel("Pix Copia e Cola", { exact: true })).toHaveValue(qr);
  const payments = api.requests.filter(request => request.path.endsWith("/pagamento"));
  expect(payments).toHaveLength(2);
  expect(payments[0].key).toBe(payments[1].key);
  expect(payments[0].body).toEqual({ iniciarPix: true });
  expect(payments[1].body).toEqual(payments[0].body);
});

test("carrinho esvaziado não recupera o pedido anterior", async ({ page }) => {
  const api = await setup(page);
  await begin(page, "Dinheiro");
  await expect(page.getByRole("heading", { name: "Pedido criado", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("lanche-falcao:cart", "[]"));
  await page.reload();
  await expect(page.getByText("Seu carrinho está vazio.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Concluir pedido", exact: true })).toHaveCount(0);
  expect(api.requests).toHaveLength(1);
});
