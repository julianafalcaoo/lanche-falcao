import { test, expect, type Page } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const qr = "pix-retornado-pelo-provedor-no-teste";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XkAAAAASUVORK5CYII=";
const challengeUrl = "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/11111111-1111-4111-8111-111111111111?display_mode=self_hosted&guest_token=browser_challenge_fixture";
const summaryAmount = (page: Page, label: string) => page.locator("dl div")
  .filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
const visibility = (page: Page, hidden: boolean) => page.evaluate(value => {
  Object.defineProperty(document, "hidden", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}, hidden);
async function setup(page: Page, production = false) {
  let currentId = id;
  let subtotal = 800, fee = 0, changeFor: number | null = null;
  const orders = new Map<string, { id: string; body: Record<string, unknown> }>();
  const requests: { path: string; body: Record<string, unknown>; key: string | undefined }[] = [];
  let method = "PIX", status = "PENDENTE", hasAttempt = false, failOrder = false, failPayment = false, cardRejected = false;
  let cardPending = false, owner = "a", orderBody: Record<string, unknown> | null = null;
  let challengeRequired = false, challengeDeclined = false, brickFailed = false;
  let reads = 0, failRead = false, readGate: Promise<void> | undefined, approveOnRecovery = false, staleOrderOnce = false;
  let pause: Promise<void> | undefined;
  await page.addInitScript(() => {
    if (!localStorage.getItem("lanche-falcao:cart")) localStorage.setItem("lanche-falcao:cart", JSON.stringify([{ productId: "coxinha-frango", quantity: 2 }]));
    if (!sessionStorage.getItem("lanche-falcao:checkout")) sessionStorage.setItem("lanche-falcao:checkout", JSON.stringify({ orderType: "pickup", address: { postalCode: "", street: "", number: "", neighborhood: "", city: "", state: "", complement: "", reference: "" } }));
  });
  const order = () => ({ id: currentId, formaPagamento: method, statusPagamento: status,
    status: "PEDIDO_RECEBIDO", tipo: orderBody?.tipo ?? "RETIRADA", endereco: orderBody?.endereco,
    itens: (orderBody?.itens as { productId: string; quantity: number }[] | undefined)?.map(item => ({
      produtoId: item.productId, nomeProduto: "Coxinha de frango", quantidade: item.quantity,
    })) ?? [],
    subtotalCentavos: subtotal, taxaEntregaCentavos: fee, totalCentavos: subtotal + fee, trocoParaCentavos: changeFor });
  const view = (includeChallenge = false) => ({
    ...(includeChallenge && challengeRequired && hasAttempt && status === "PENDENTE" ? { desafio3dsUrl: challengeUrl } : {}),
    pedido: order(), tentativa: hasAttempt ? {
      id: "attempt", statusExterno: status === "APROVADO" ? "processed" : status === "RECUSADO" ? "failed" : status === "CANCELADO" ? "canceled" : "action_required",
      detalheExterno: status === "APROVADO" ? "accredited" : status === "CANCELADO" ? "expired" : challengeRequired ? "pending_challenge" : "waiting_transfer",
      codigoErro: challengeDeclined ? "CARTAO_3DS_RECUSADO" : null, podeTentarNovamente: status === "RECUSADO" || status === "CANCELADO",
      aguardando: status === "PENDENTE", qrCode: method === "PIX" && status === "PENDENTE" ? (currentId === id ? qr : `${qr}-${currentId}`) : null,
      qrCodeBase64: png, ticketUrl: null,
    } : null,
  });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.href === challengeUrl) return route.fulfill({ contentType: "text/html", body: `<button onclick="parent.postMessage({status:'COMPLETE'},'http://127.0.0.1:3100')">Concluir desafio simulado</button>` });
    if (url.href === "https://sdk.mercadopago.com/js/v2") return route.fulfill({ contentType: "application/javascript", body: `
      window.MercadoPago = class {
        bricks() { return { create: async (type, id, settings) => {
          if (settings.initialization.payer && settings.initialization.payer.email !== "test@testuser.com") throw new Error("Unexpected email initialization");
          const root = document.getElementById(id);
          if (${brickFailed} && !window.fixtureBrickFailed) {
            window.fixtureBrickFailed = true;
            throw new Error("Falha simulada do Brick");
          }
          root.dataset.amount = String(settings.initialization.amount);
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
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { autenticado: true, cliente: { nome: "Cliente teste", telefone: "+5592999999999" }, checkoutScope: owner.repeat(64) } });
    if (url.pathname === "/api/pagamentos/config") return route.fulfill({ json: { publicKey: "mock-public", ambiente: production ? "production" : "test", payerEmail: production ? null : "test@testuser.com" } });
    if (url.pathname.startsWith("/api/pedidos/") && owner !== "a") return route.fulfill({ status: 404, json: {} });
    if (route.request().method() === "PATCH" && url.pathname === `/api/pedidos/${currentId}`) {
      const body = route.request().postDataJSON();
      requests.push({ path: url.pathname, body, key: undefined });
      if (hasAttempt || status !== "PENDENTE") return route.fulfill({ status: 409, json: { mensagem: "A forma de pagamento está bloqueada." } });
      method = body.formaPagamento;
      changeFor = body.trocoParaCentavos ?? null;
      return route.fulfill({ json: { pedido: order() } });
    }
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
          orderBody = body;
          subtotal = body.itens.reduce((sum: number, item: { quantity: number }) => sum + item.quantity * 400, 0);
          fee = body.tipo === "ENTREGA" ? 300 : 0;
          changeFor = body.trocoParaCentavos ?? null;
          hasAttempt = false; status = "PENDENTE";
        } else currentId = orders.get(key)!.id;
        return route.fulfill({ status: 201, json: { pedido: order() } });
      }
      if (url.pathname.endsWith("/pagamento")) {
        if (failPayment) { failPayment = false; return route.abort(); }
        if (!body.consultar) hasAttempt = true;
        if (body.consultar && approveOnRecovery) status = "APROVADO";
        if (method === "CARTAO" && !body.consultar && !cardPending) status = cardRejected ? "RECUSADO" : "APROVADO";
        return route.fulfill({ json: view(true) });
      }
    }
    if (url.pathname === `/api/pedidos/${currentId}`) return route.fulfill({ json: { pedido: order() } });
    if (url.pathname.endsWith("/pagamento")) {
      reads++;
      await readGate;
      if (failRead) { failRead = false; return route.abort(); }
      const value = view();
      if (staleOrderOnce) { staleOrderOnce = false; value.pedido.statusPagamento = "PENDENTE"; }
      return route.fulfill({ json: value });
    }
    return route.abort();
  });
  return { requests, approve: () => { status = "APROVADO"; }, holdCard: () => { cardPending = true; }, otherCustomer: () => { owner = "b"; },
    seedPixOrder: () => { orderBody = { tipo: "RETIRADA", itens: [{ productId: "coxinha-frango", quantity: 2 }] }; },
    requireChallenge: () => { challengeRequired = true; cardPending = true; },
    declineChallenge: () => { challengeDeclined = true; status = "RECUSADO"; },
    failBrick: () => { brickFailed = true; },
    expire: () => { status = "CANCELADO"; }, reads: () => reads, failRead: () => { failRead = true; }, holdRead: (gate?: Promise<void>) => { readGate = gate; },
    approveOnRecovery: () => { approveOnRecovery = true; },
    approveAcrossReads: () => { status = "APROVADO"; staleOrderOnce = true; },
    pause: (value: Promise<void>) => { pause = value; }, failOrder: () => { failOrder = true; }, failPayment: () => { failPayment = true; }, rejectCard: (value: boolean) => { cardRejected = value; } };
}
async function begin(page: Page, method: string) {
  await page.goto("/checkout");
  await page.getByRole("radio", { name: method, exact: true }).check();
  await page.getByRole("button", { name: "Finalizar pedido", exact: true }).click();
}
for (const method of ["Cartão", "Dinheiro"]) {
  test(`checkout exibe taxa de entrega e usa o total persistido em ${method}`, async ({ page }) => {
    const api = await setup(page);
    await page.goto("/checkout");
    const amount = (label: string) => summaryAmount(page, label);
    await expect(amount("Taxa de entrega")).toHaveText(/R\$\s*0,00/);
    await page.getByRole("radio", { name: "Entrega", exact: true }).check();
    await expect(amount("Taxa de entrega")).toHaveText(/R\$\s*3,00/);
    await expect(amount("Total")).toHaveText(/R\$\s*11,00/);
    await page.getByRole("radio", { name: "Retirar na lanchonete" }).check();
    await expect(amount("Total")).toHaveText(/R\$\s*8,00/);
    await page.getByRole("radio", { name: "Entrega", exact: true }).check();
    for (const [field, value] of Object.entries({ postalCode: "69000000", street: "Rua A", number: "10", neighborhood: "Centro", city: "Manaus", state: "AM" })) {
      await page.locator(`#${field}`).fill(value);
    }
    await page.getByRole("radio", { name: method, exact: true }).check();
    if (method === "Dinheiro") {
      await page.getByRole("radio", { name: "Sim", exact: true }).check();
      await page.locator('[name="trocoValor"]').fill("10,99");
      await page.getByRole("button", { name: "Finalizar pedido" }).click();
      expect(api.requests).toHaveLength(0);
      await page.locator('[name="trocoValor"]').fill("20,00");
    }
    await page.getByRole("button", { name: "Finalizar pedido" }).click();
    await expect(page.getByRole("heading", { name: method === "Dinheiro" ? "Pedido criado" : "Pagamento com cartão" })).toBeVisible();
    await expect(amount("Subtotal dos produtos")).toHaveText(/R\$\s*8,00/);
    await expect(amount("Taxa de entrega")).toHaveText(/R\$\s*3,00/);
    await expect(amount("Total")).toHaveText(/R\$\s*11,00/);
    expect(api.requests[0].body).not.toHaveProperty("totalCentavos");
    expect(api.requests[0].body).not.toHaveProperty("taxaEntregaCentavos");
    if (method === "Dinheiro") await expect(page.getByText(/Troco: R\$\s*9,00/)).toBeVisible();
    else await expect(page.locator("#card-payment-brick")).toHaveAttribute("data-amount", "11");
  });
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
test("alterar antes de cobrar preserva pedido, entrega, identificação e total", async ({ page }) => {
  const api = await setup(page, true);
  await page.goto("/checkout");
  await page.getByRole("radio", { name: "Entrega", exact: true }).check();
  for (const [field, value] of Object.entries({ postalCode: "69000000", street: "Rua A", number: "10", neighborhood: "Centro", city: "Manaus", state: "AM" })) {
    await page.locator(`#${field}`).fill(value);
  }
  await page.getByRole("radio", { name: "PIX", exact: true }).check();
  await page.getByRole("button", { name: "Finalizar pedido" }).click();
  await expect(page.getByRole("button", { name: "Gerar Pix" })).toBeVisible();
  await page.getByRole("button", { name: "Alterar forma de pagamento" }).click();
  await page.reload();
  await expect(page.getByText("Cliente teste")).toBeVisible();
  await expect(page.getByText(/Rua A, 10/)).toBeVisible();
  await expect(page.getByText("2 × Coxinha de frango")).toBeVisible();
  await expect(summaryAmount(page, "Taxa de entrega")).toHaveText(/R\$\s*3,00/);
  await expect(summaryAmount(page, "Total")).toHaveText(/R\$\s*11,00/);
  await page.getByRole("radio", { name: "Cartão", exact: true }).check();
  await page.getByRole("button", { name: "Continuar para pagamento" }).click();
  await expect(page.locator("#card-payment-brick")).toHaveAttribute("data-amount", "11");
  await expect.poll(() => api.requests.map(request => request.path)).toEqual(["/api/pedidos", `/api/pedidos/${id}`]);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("lanche-falcao:order-flow")!))).toEqual({ pedidoId: id });
});

test("Voltar e Avançar retomam Pix pendente sem nova cobrança mesmo com carrinho alterado", async ({ page }) => {
  const api = await setup(page);
  await begin(page, "PIX");
  const code = page.getByLabel("Pix Copia e Cola", { exact: true });
  await expect(code).toHaveValue(qr);
  await page.goBack();
  await expect(page.getByText(/Existe um pagamento em andamento/)).toBeVisible();
  await expect(page.getByRole("radio", { name: "Cartão", exact: true })).toHaveCount(0);
  await page.goForward();
  await expect(code).toHaveValue(qr);
  await page.evaluate(() => localStorage.setItem("lanche-falcao:cart", JSON.stringify([{ productId: "coxinha-frango", quantity: 3 }])));
  await page.reload();
  await expect(code).toHaveValue(qr);
  await page.getByRole("button", { name: "Alterar forma de pagamento" }).click();
  await page.getByRole("button", { name: "Retomar pagamento" }).click();
  await expect(code).toHaveValue(qr);
  expect(api.requests.map(request => request.path)).toEqual(["/api/pedidos", `/api/pedidos/${id}/pagamento`]);
});

test("cartão pendente volta à seleção e exibe a aprovação recebida durante a navegação", async ({ page }) => {
  const api = await setup(page);
  api.holdCard();
  await begin(page, "Cartão");
  await page.getByRole("button", { name: "Pagar com cartão de teste" }).click();
  await expect(page.getByRole("button", { name: "Pagar com cartão de teste" })).toHaveCount(0);
  await page.getByRole("button", { name: "Alterar forma de pagamento" }).click();
  await expect(page.getByText(/Existe um pagamento em andamento/)).toBeVisible();
  await page.getByRole("button", { name: "Retomar pagamento" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Alterar forma de pagamento" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar com cartão de teste" })).toHaveCount(0);
  await page.getByRole("button", { name: "Alterar forma de pagamento" }).click();
  await expect(page.getByText(/Existe um pagamento em andamento/)).toBeVisible();
  api.approve();
  await expect(page.getByText("Pagamento aprovado.")).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole("button", { name: "Alterar forma de pagamento" })).toHaveCount(0);
  expect(api.requests).toHaveLength(2);
});

test("outra identificação não abre o pedido salvo", async ({ page }) => {
  const api = await setup(page);
  await begin(page, "PIX");
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveValue(qr);
  api.otherCustomer();
  await page.reload();
  await expect(page.getByText(/não pode ser retomado com a identificação atual/)).toBeVisible();
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveCount(0);
  expect(api.requests).toHaveLength(2);
});

test("Pix pausa em aba oculta, retoma imediatamente sem sobreposição e recupera falha temporária", async ({ page }) => {
  const api = await setup(page);
  await page.clock.install();
  await begin(page, "PIX");
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveValue(qr);
  await visibility(page, true);
  const initial = api.reads();
  await page.clock.runFor(15000);
  expect(api.reads()).toBe(initial);

  let release!: () => void;
  api.holdRead(new Promise<void>(resolve => { release = resolve; }));
  try {
    await visibility(page, false);
    await expect.poll(api.reads).toBe(initial + 1);
    await page.clock.runFor(15000);
    expect(api.reads()).toBe(initial + 1);
    api.failRead();
  } finally {
    api.holdRead();
    release();
  }
  await expect(page.getByText(/Falha temporária na consulta/)).toBeVisible();
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveValue(qr);
  api.approve();
  await page.clock.runFor(12000);
  await expect(page.getByText("Pagamento aprovado.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verificar pagamento", exact: true })).toHaveCount(0);
  const readsAfterApproval = api.reads();
  await page.clock.runFor(15000);
  expect(api.reads()).toBe(readsAfterApproval);
  expect(api.requests.filter(request => request.path.endsWith("/pagamento"))).toHaveLength(1);
});

test("Pix mantém pendência sem prazo confirmado e usa consulta de recuperação sem cobrar novamente", async ({ page }) => {
  const api = await setup(page);
  await page.clock.install();
  await begin(page, "PIX");
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveValue(qr);
  const firstRead = page.waitForResponse(response => response.url().endsWith("/pagamento") && response.request().method() === "GET");
  await visibility(page, false);
  await firstRead;
  await visibility(page, true);
  await page.clock.fastForward(25 * 60 * 60 * 1000);
  await expect(page.getByText("O status do Pix é atualizado automaticamente.")).toBeVisible();
  await expect(page.getByText(/Pix expirado/)).toHaveCount(0);
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveValue(qr);
  api.approveOnRecovery();
  await visibility(page, false);
  await expect(page.getByText("Pagamento aprovado.")).toBeVisible();
  const payments = api.requests.filter(request => request.path.endsWith("/pagamento"));
  expect(payments.filter(request => request.key)).toHaveLength(1);
  expect(payments.filter(request => request.body.consultar)).not.toHaveLength(0);
});

test("Pix expirado pelo backend oculta o QR e interrompe acompanhamento", async ({ page }) => {
  const api = await setup(page);
  await page.clock.install();
  await begin(page, "PIX");
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveValue(qr);
  api.expire();
  await page.clock.runFor(6000);
  await expect(page.getByText("Pix expirado. O vencimento foi confirmado.")).toBeVisible();
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveCount(0);
  const finalReads = api.reads();
  await page.clock.runFor(15000);
  expect(api.reads()).toBe(finalReads);
  expect(api.requests.filter(request => request.path.endsWith("/pagamento"))).toHaveLength(1);
});

test("Pix segue consultando quando a tentativa atualiza antes da leitura do pedido", async ({ page }) => {
  const api = await setup(page);
  await page.clock.install();
  await begin(page, "PIX");
  await expect(page.getByLabel("Pix Copia e Cola")).toHaveValue(qr);
  api.approveAcrossReads();
  const previousReads = api.reads();
  await page.clock.runFor(6000);
  await expect.poll(api.reads).toBeGreaterThan(previousReads);
  await expect(page.getByText("O status do Pix é atualizado automaticamente.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar pagamento novamente" })).toHaveCount(0);
  await page.clock.runFor(6000);
  await expect(page.getByText("Pagamento aprovado.")).toBeVisible();
});
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
    await expect(page.getByText("Pagamento aprovado.")).toBeVisible({ timeout: 12000 });
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

test("cartão 3DS retoma após reload e evento do iframe só solicita confirmação", async ({ page }) => {
  const api = await setup(page);
  api.requireChallenge();
  await begin(page, "Cartão");
  await page.getByRole("button", { name: "Pagar com cartão de teste" }).click();
  const frame = page.frameLocator('iframe[title="Verificação 3DS do cartão"]');
  await expect(frame.getByRole("button", { name: "Concluir desafio simulado" })).toBeVisible();
  await page.reload();
  await expect(frame.getByRole("button", { name: "Concluir desafio simulado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar com cartão de teste" })).toHaveCount(0);
  await page.evaluate(() => window.postMessage({ status: "COMPLETE" }, location.origin));
  await expect(page.getByText(/Autenticação enviada/)).toHaveCount(0);
  const previous = api.requests.length;
  await frame.getByRole("button", { name: "Concluir desafio simulado" }).click();
  await expect(page.getByText(/Autenticação enviada/)).toBeVisible();
  await expect.poll(() => api.requests.length).toBeGreaterThan(previous);
  await expect(page.getByText("Pagamento aprovado.")).toHaveCount(0);
  api.approve();
  await expect(page.getByText("Pagamento aprovado.")).toBeVisible({ timeout: 12000 });
  await expect(page.getByTitle("Verificação 3DS do cartão")).toHaveCount(0);
  expect(api.requests.filter(request => request.body.card)).toHaveLength(1);
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain("guest_token");
});

test("cliente reencontra pedido de cartão sem o armazenamento da aba e retoma o mesmo desafio no celular", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const api = await setup(page);
  api.requireChallenge();
  await page.goto("/checkout");
  await expect(page.getByRole("button", { name: "Finalizar pedido" })).toBeVisible();
  await expect(page.getByText("Meus pedidos", { exact: true })).toHaveCount(0);
  expect(api.requests).toHaveLength(0);
  await begin(page, "Cartão");
  await page.getByRole("button", { name: "Pagar com cartão de teste" }).click();
  await expect(page.getByTitle("Verificação 3DS do cartão")).toBeVisible();
  const link = await page.getByRole("link", { name: "Link para retomar este pagamento" }).getAttribute("href");
  expect(link).toBe(`/checkout?pedido=${id}`);
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto(link!);
  await expect(page).toHaveURL(new RegExp(`/checkout\\?pedido=${id}$`));
  await expect(page.getByText(/Existe um pagamento em andamento/)).toBeVisible();
  expect(api.requests.filter(request => request.body.card)).toHaveLength(1);
  await page.getByRole("button", { name: "Retomar pagamento" }).click();
  await expect(page.getByTitle("Verificação 3DS do cartão")).toBeVisible();
  await page.reload();
  await expect(page.getByTitle("Verificação 3DS do cartão")).toBeVisible();
  expect(api.requests.filter(request => request.path === "/api/pedidos")).toHaveLength(1);
  expect(api.requests.filter(request => request.body.card)).toHaveLength(1);
});

test("link direto de outro cliente não expõe o pedido nem inicia pagamento", async ({ page }) => {
  const api = await setup(page);
  api.otherCustomer();
  await page.goto(`/checkout?pedido=${id}&etapa=pagamento`);
  await expect(page.getByText("Este checkout salvo não pode ser retomado com a identificação atual.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar com cartão de teste" })).toHaveCount(0);
  expect(api.requests).toHaveLength(0);
});

test("abrir link direto de Pix de teste nunca gera cobrança automaticamente", async ({ page }) => {
  const api = await setup(page);
  api.seedPixOrder();
  await page.goto(`/checkout?pedido=${id}&etapa=pagamento`);
  await expect(page.getByRole("button", { name: "Gerar Pix de teste" })).toBeVisible();
  expect(api.requests).toHaveLength(0);
});

test("recarregar Pix existente sem tentativa exige confirmação para gerar cobrança", async ({ page }) => {
  const api = await setup(page);
  api.seedPixOrder();
  await page.addInitScript(pedidoId => {
    sessionStorage.setItem("lanche-falcao:order-flow", JSON.stringify({ pedidoId }));
  }, id);
  await page.goto("/checkout?etapa=pagamento");
  await expect(page.getByRole("button", { name: "Gerar Pix de teste" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Gerar Pix de teste" })).toBeVisible();
  expect(api.requests).toHaveLength(0);
});

for (const expired of [false, true]) {
  test(`cartão 3DS ${expired ? "abandonado e expirado" : "recusado"} só libera retry após confirmação`, async ({ page }) => {
    const api = await setup(page);
    api.requireChallenge();
    await begin(page, "Cartão");
    await page.getByRole("button", { name: "Pagar com cartão de teste" }).click();
    await expect(page.getByTitle("Verificação 3DS do cartão")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar pagamento novamente" })).toHaveCount(0);
    await page.getByRole("button", { name: "Alterar forma de pagamento" }).click();
    await expect(page.getByText(/Existe um pagamento em andamento/)).toBeVisible();
    await page.getByRole("button", { name: "Retomar pagamento" }).click();
    await expect(page.getByTitle("Verificação 3DS do cartão")).toBeVisible();
    if (expired) api.expire();
    else api.declineChallenge();
    await expect(page.getByRole("button", { name: "Tentar pagamento novamente" })).toBeVisible({ timeout: 12000 });
    await expect(page.getByText(expired ? /tentativa de cartão expirou/ : /autenticação do cartão foi recusada/)).toBeVisible();
    if (!expired) {
      await page.reload();
      await expect(page.getByText(/autenticação do cartão foi recusada/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Tentar pagamento novamente" })).toBeVisible();
    }
    expect(api.requests.filter(request => request.body.card)).toHaveLength(1);
  });
}

test("erro do Brick permite recarregar o formulário sem enviar pagamento", async ({ page }) => {
  const api = await setup(page);
  api.failBrick();
  await begin(page, "Cartão");
  const retry = page.getByRole("button", { name: "Recarregar formulário de cartão" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByRole("button", { name: "Pagar com cartão de teste" })).toBeVisible();
  expect(api.requests.filter(request => request.body.card)).toHaveLength(0);
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

test("carrinho esvaziado não descarta a referência do pedido", async ({ page }) => {
  const api = await setup(page);
  await begin(page, "Dinheiro");
  await expect(page.getByRole("heading", { name: "Pedido criado", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("lanche-falcao:cart", "[]"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Concluir pedido", exact: true })).toBeVisible();
  expect(api.requests).toHaveLength(1);
});
