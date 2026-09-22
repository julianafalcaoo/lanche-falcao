import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { cadastroLeadSchema } from "./validation";

export async function cadastrarLead(input: unknown) {
  const parsed = cadastroLeadSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "invalid" as const,
      campos: parsed.error.issues.map((issue) => ({
        campo: issue.path.join(".") || "body",
        mensagem: issue.message,
      })),
    };
  }

  try {
    const lead = await prisma.lead.create({
      data: { ...parsed.data, emailVerificado: false },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        emailVerificado: true,
        createdAt: true,
      },
    });

    return { status: "created" as const, lead };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "duplicate" as const };
    }
    throw error;
  }
}
