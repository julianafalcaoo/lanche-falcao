import { test, expect, type Page } from "@playwright/test";

const customer = { nome: "Maria Teste", telefone: "+5592999999999" };
const draft = { orderType: "pickup", address: { postalCode: "", street: "", number: "", neighborhood: "", city: "", state: "", complement: "", reference: "" } };
async function setup(page: Page, logged = false, seedDraft = draft) {
  let authenticated = logged;
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let sendError = "";
  let verifyError = "";
  let sessionError = false;
  let pauseSession: Promise<void> | undefined;
  let pauseSend: Promise<void> | undefined;
  await page.addInitScript(({ seedDraft }) => {
    if (!localStorage.getItem("lanche-falcao:cart")) localStorage.setItem("lanche-falcao:cart", JSON.stringify([{ productId: "esfirra-carne", quantity: 2 }]));
    if (!sessionStorage.getItem("lanche-falcao:checkout")) sessionStorage.setItem("lanche-falcao:checkout", JSON.stringify(seedDraft));
  }, { seedDraft });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3100") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (!url.pathname.startsWith("/api/auth/")) return route.abort();
    const path = url.pathname.split("/api/auth/")[1];
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    requests.push({ path, body });
    if (path === "me") {
      await pauseSession;
      return route.fulfill({ status: sessionError ? 503 : authenticated ? 200 : 401, json: sessionError ? {} : authenticated ? { autenticado: true, cliente: customer } : { autenticado: false } });
    }
    if (path === "otp/solicitar") {
      await pauseSend;
      return route.fulfill({ status: sendError ? 429 : 200, json: sendError ? { erro: sendError } : { enviado: true, desafioId: String(requests.length % 10).repeat(64) } });
    }
    if (path === "otp/verificar") {
      if (verifyError) return route.fulfill({ status: 422, json: { erro: verifyError } });
      authenticated = true;
      return route.fulfill({ json: { verificado: true, autenticado: true } });
    }
    if (path === "logout") { authenticated = false; return route.fulfill({ json: { autenticado: false } }); }
    return route.abort();
  });
  return { requests, sendError: (code: string) => { sendError = code; }, verifyError: (code: string) => { verifyError = code; },
    sessionError: (value: boolean) => { sessionError = value; }, pauseSession: (value: Promise<void>) => { pauseSession = value; }, pauseSend: (value: Promise<void>) => { pauseSend = value; } };
}
async function identify(page: Page) {
  await page.getByLabel("Nome", { exact: true }).fill("  Maria Teste  ");
  await page.getByLabel("Celular", { exact: true }).fill("92999999999");
  await page.getByRole("button", { name: "Enviar código", exact: true }).click();
  await expect(page.getByLabel("Código de 4 dígitos")).toBeVisible();
}
const storage = (page: Page) => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));

test("consulta sessão sem flicker e recupera falha inesperada", async ({ page }) => {
  const api = await setup(page);
  let release!: () => void;
  api.pauseSession(new Promise<void>((resolve) => { release = resolve; }));
  await page.goto("/checkout");
  await expect(page.getByText("Verificando sua identificação…")).toBeVisible();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveCount(0);
  api.sessionError(true); release();
  await expect(page.getByText("Não foi possível consultar sua identificação.")).toBeVisible();
  api.sessionError(false);
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeDisabled();
});

test("valida campos, bloqueia clique duplicado e mantém contrato e foco OTP", async ({ page }) => {
  const api = await setup(page);
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Enviar código", exact: true }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toBeFocused();
  await page.getByLabel("Nome", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Enviar código", exact: true }).click();
  await expect(page.getByText("Informe um nome de até 100 caracteres.")).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill("  Maria  ");
  await page.getByLabel("Celular", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Enviar código", exact: true }).click();
  await expect(page.getByLabel("Celular", { exact: true })).toBeFocused();
  await page.getByLabel("Celular", { exact: true }).fill("92999999999");
  let release!: () => void;
  api.pauseSend(new Promise<void>((resolve) => { release = resolve; }));
  await page.getByRole("button", { name: "Enviar código", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole("button", { name: "Enviando código...", exact: true })).toBeDisabled();
  await expect.poll(() => api.requests.filter((r) => r.path === "otp/solicitar").length).toBe(1);
  release();
  const otp = page.getByLabel("Código de 4 dígitos");
  await expect(otp).toBeFocused();
  expect(api.requests.find((r) => r.path === "otp/solicitar")?.body).toEqual({ nome: "Maria", telefone: "(92) 99999-9999" });
  await otp.fill("ab12"); await expect(otp).toHaveValue("12");
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await expect(page.getByText("Digite os quatro números do código recebido.")).toBeVisible();
  expect(api.requests.filter((r) => r.path === "otp/verificar")).toHaveLength(0);
});

test("OTP errado, expirado, reenvio limitado e alteração de celular", async ({ page }) => {
  const api = await setup(page);
  await page.goto("/checkout"); await identify(page);
  api.verifyError("CODIGO_INCORRETO");
  await page.getByLabel("Código de 4 dígitos").fill("1234");
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await expect(page.getByText("Código incorreto. Confira o SMS e tente novamente.")).toBeVisible();
  api.verifyError("CODIGO_EXPIRADO");
  await page.getByLabel("Código de 4 dígitos").fill("1234");
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await expect(page.getByText("O código expirou. Solicite um novo código.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar código" })).toBeDisabled();
  api.sendError("LIMITE_EXCEDIDO");
  await page.getByRole("button", { name: "Solicitar novo código", exact: true }).click();
  await expect(page.getByText("Limite de solicitações atingido. Aguarde antes de tentar novamente.")).toBeVisible();
  api.sendError("");
  await page.getByRole("button", { name: "Solicitar novo código", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmar código" })).toBeEnabled();
  await expect(page.getByLabel("Código de 4 dígitos")).toHaveValue("");
  const count = api.requests.filter((r) => r.path === "otp/solicitar").length;
  await page.getByRole("button", { name: "Alterar celular" }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("  Maria Teste  ");
  await expect(page.getByLabel("Celular", { exact: true })).toHaveValue("(92) 99999-9999");
  expect(api.requests.filter((r) => r.path === "otp/solicitar")).toHaveLength(count);
});

test("OTP correto consulta me, preserva carrinho/draft, refresh e logout", async ({ page }) => {
  const api = await setup(page);
  await page.goto("/checkout"); await identify(page);
  const before = await storage(page);
  await page.getByLabel("Código de 4 dígitos").fill("0123");
  await page.getByRole("button", { name: "Confirmar código" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByText("Pedido para Maria Teste")).toBeVisible();
  expect(api.requests.filter((r) => r.path === "otp/verificar")).toHaveLength(1);
  const verification = api.requests.find((r) => r.path === "otp/verificar")!;
  expect(Object.keys(verification.body).sort()).toEqual(["codigo", "desafioId"]);
  expect(await storage(page)).toEqual(before);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText(/Identificação concluída. Tudo pronto/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Pedido para Maria Teste")).toBeVisible();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "← Voltar ao carrinho" }).click();
  await page.goto("/checkout");
  await expect(page.getByText("Pedido para Maria Teste")).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toBeVisible();
  expect(await storage(page)).toEqual(before);
});

test("autenticado valida Entrega e preserva endereço no refresh", async ({ page }) => {
  await setup(page, true);
  await page.goto("/checkout");
  await expect(page.getByText("Pedido para Maria Teste")).toBeVisible();
  await page.getByRole("radio", { name: "Entrega", exact: true }).check();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("CEP *", { exact: true })).toBeFocused();
  for (const [label, value] of [["CEP *", "69000000"], ["Rua *", "Rua de teste"], ["Número *", "10"], ["Bairro *", "Centro"], ["Cidade *", "Manaus"], ["UF *", "AM"]]) await page.getByLabel(label, { exact: true }).fill(value);
  const before = await storage(page);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText(/Identificação concluída. Tudo pronto/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Entrega", exact: true })).toBeChecked();
  await expect(page.getByLabel("Rua *", { exact: true })).toHaveValue("Rua de teste");
  expect(await storage(page)).toEqual(before);
});

for (const width of [320, 375, 430, 768, 1024, 1440]) {
  test(`identificação e OTP sem overflow em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page); await page.goto("/checkout");
    await expect(page.getByLabel("Nome", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await identify(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("Código de 4 dígitos").fill("1234");
    await page.getByRole("button", { name: "Confirmar código" }).click();
    await expect(page.getByText("Pedido para Maria Teste")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const [code, message] of [
  ["TENTATIVAS_ESGOTADAS", "O limite de tentativas foi atingido. Solicite um novo código."],
  ["DESAFIO_INVALIDO", "Não foi possível usar este código. Solicite um novo código."],
  ["PROVEDOR_INDISPONIVEL", "Não foi possível continuar agora. Tente novamente mais tarde."],
]) {
  test(`erro ${code} não autentica nem reenvia automaticamente`, async ({ page }) => {
    const api = await setup(page); await page.goto("/checkout"); await identify(page);
    api.verifyError(code);
    await page.getByLabel("Código de 4 dígitos").fill("1234");
    await page.getByRole("button", { name: "Confirmar código" }).click();
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeDisabled();
    expect(api.requests.filter((r) => r.path === "otp/solicitar")).toHaveLength(1);
  });
}

test("novo código substitui desafio; refresh não persiste identificação temporária", async ({ page }) => {
  const api = await setup(page); await page.goto("/checkout"); await identify(page);
  await page.getByRole("button", { name: "Solicitar novo código", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmar código" })).toBeEnabled();
  const latest = String(api.requests.length % 10).repeat(64);
  api.verifyError("CODIGO_INCORRETO");
  await page.getByLabel("Código de 4 dígitos").fill("1234");
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await expect(page.getByText("Código incorreto. Confira o SMS e tente novamente.")).toBeVisible();
  expect(api.requests.find((r) => r.path === "otp/verificar")?.body.desafioId).toBe(latest);
  await page.reload();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Código de 4 dígitos")).toHaveCount(0);
  expect(api.requests.filter((r) => r.path === "otp/solicitar")).toHaveLength(2);
});

test("sem tipo válido ou carrinho não conclui a etapa", async ({ page }) => {
  await setup(page, true); await page.goto("/checkout");
  await expect(page.getByText("Pedido para Maria Teste")).toBeVisible();
  await page.evaluate(() => {
    const draft = JSON.parse(sessionStorage.getItem("lanche-falcao:checkout")!);
    draft.orderType = null;
    sessionStorage.setItem("lanche-falcao:checkout", JSON.stringify(draft));
  });
  await page.reload();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByText("Escolha Retirada ou Entrega para continuar.")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("lanche-falcao:cart", "[]"));
  await page.reload();
  await expect(page.getByText("Seu carrinho está vazio.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toHaveCount(0);
});
