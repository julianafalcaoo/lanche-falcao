import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { lead: { create } } }));

import { POST } from "@/app/api/leads/route";
import { Prisma } from "@/generated/prisma/client";

const valid = { nome: " Ana Silva ", email: " ANA@EXAMPLE.COM ", telefone: "(92) 99999-1234" };
const saved = {
  id: "test-lead",
  nome: "Ana Silva",
  email: "ana@example.com",
  telefone: "+5592999991234",
  emailVerificado: false,
  createdAt: new Date("2026-09-21T12:00:00Z"),
};
const post = (input: unknown) => POST(new Request("http://localhost/api/leads", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(input),
}));

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue(saved);
});

describe("POST /api/leads", () => {
  it("cadastra dados normalizados e impede a atribuição de campos internos", async () => {
    const response = await post({ ...valid, id: "injetado", emailVerificado: true });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ lead: { ...saved, createdAt: saved.createdAt.toISOString() } });
    expect(create).toHaveBeenCalledExactlyOnceWith({
      data: { nome: saved.nome, email: saved.email, telefone: saved.telefone, emailVerificado: false },
      select: { id: true, nome: true, email: true, telefone: true, emailVerificado: true, createdAt: true },
    });
  });

  it.each([
    ["nome vazio", { ...valid, nome: "   " }, "nome"],
    ["nome de tipo incorreto", { ...valid, nome: 123 }, "nome"],
    ["e-mail ausente", { ...valid, email: undefined }, "email"],
    ["e-mail inválido", { ...valid, email: "ana@" }, "email"],
    ["e-mail com pontos consecutivos", { ...valid, email: "ana..silva@example.com" }, "email"],
    ["telefone ausente", { ...valid, telefone: undefined }, "telefone"],
    ["telefone curto", { ...valid, telefone: "123" }, "telefone"],
    ["telefone sem DDD", { ...valid, telefone: "99999-1234" }, "telefone"],
    ["telefone com letras", { ...valid, telefone: "ligue (92) 99999-1234" }, "telefone"],
    ["telefone com DDD inválido", { ...valid, telefone: "(00) 99999-1234" }, "telefone"],
    ["telefone numérico", { ...valid, telefone: 92999991234 }, "telefone"],
    ["nome longo", { ...valid, nome: "a".repeat(201) }, "nome"],
  ])("rejeita %s antes de acessar o banco", async (_label, input, campo) => {
    const response = await post(input);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ erro: "Dados inválidos.", campos: expect.arrayContaining([expect.objectContaining({ campo })]) });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([null, [], "texto", 42])("rejeita corpo que não é objeto: %j", async (input) => {
    expect((await post(input)).status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["+55 (92) 99999-1234", "92999991234"])("normaliza telefone %s", async (telefone) => {
    expect((await post({ ...valid, telefone })).status).toBe(201);
    expect(create.mock.calls[0][0].data.telefone).toBe("+5592999991234");
  });

  it("retorna 409 para a restrição única de e-mail sem expor o Prisma", async () => {
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("detalhes internos", {
      code: "P2002", clientVersion: "7.10.0", meta: { target: ["email"] },
    }));
    const response = await post(valid);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ erro: "E-mail já cadastrado." });
  });

  it("retorna 500 genérico em falha inesperada", async () => {
    create.mockRejectedValue(new Error("credenciais e stack internos"));
    const response = await post(valid);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ erro: "Não foi possível cadastrar o lead." });
  });

  it("retorna 400 para JSON malformado", async () => {
    const response = await POST(new Request("http://localhost/api/leads", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("retorna 415 para conteúdo não JSON", async () => {
    const response = await POST(new Request("http://localhost/api/leads", { method: "POST", body: "nome=Ana" }));
    expect(response.status).toBe(415);
    expect(create).not.toHaveBeenCalled();
  });
});
