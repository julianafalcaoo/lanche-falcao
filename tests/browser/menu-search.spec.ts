import { test, expect } from "@playwright/test";

for (const width of [320, 375, 430, 768, 1024, 1440]) {
  test(`pesquisa global, restauração e compra em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1:3100" || url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    await page.goto("/");
    const search = page.getByRole("searchbox");
    const banner = page.locator(".welcome-banner");
    const filters = page.getByRole("group", { name: "Filtrar por categoria" });
    const names = page.locator(".product-card h3");
    await expect(banner).toBeVisible();
    await expect(filters).toBeVisible();
    await filters.getByRole("button", { name: "Sucos", exact: true }).click();
    const previousProducts = await names.allTextContents();
    for (const query of ["coxinha", "  COXINHA  "]) {
      await search.fill(query);
      await expect(banner).toHaveCount(0);
      await expect(filters).toHaveCount(0);
      await expect(names).toHaveText(["Coxinha de frango"]);
    }
    await page.getByRole("button", { name: "Coxinha de frango", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Aumentar quantidade" }).click();
    await dialog.getByRole("button", { name: "Adicionar ao carrinho", exact: true }).click();
    await expect(dialog.getByText("2 unidades adicionadas ao carrinho.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Adicionar Coxinha de frango", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("lanche-falcao:cart") || "[]")[0]?.quantity)).toBe(3);
    await search.fill("cupuacu");
    await expect(names).toHaveText(["Suco de cupuaçu"]);
    await search.fill("pizza");
    await expect(names).toHaveCount(0);
    await expect(page.getByText("Nenhum resultado por aqui")).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(filters).toHaveCount(0);
    await expect(search).toBeVisible();
    for (const query of ["", "   "]) {
      await search.fill(query);
      await expect(banner).toBeVisible();
      await expect(filters).toBeVisible();
      await expect(filters.getByRole("button", { name: "Sucos", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(names).toHaveText(previousProducts);
    }
    await search.fill("coxinha");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const sectionTop = await page.locator("#cardapio").evaluate((el) => el.getBoundingClientRect().top);
    const mainTop = await page.locator("main").evaluate((el) => el.getBoundingClientRect().top);
    expect(sectionTop - mainTop).toBeLessThanOrEqual(32);
    await page.getByRole("button", { name: "Limpar pesquisa", exact: true }).click();
    await expect(filters).toBeVisible();
    await expect(names).toHaveText(previousProducts);
  });
}
