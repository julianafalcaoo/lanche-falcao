import { cadastrarLead } from "@/lib/leads/register";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ erro: "Utilize Content-Type: application/json." }, { status: 415 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }

  try {
    const result = await cadastrarLead(input);
    if (result.status === "invalid") {
      return Response.json({ erro: "Dados inválidos.", campos: result.campos }, { status: 422 });
    }
    if (result.status === "duplicate") {
      return Response.json({ erro: "Telefone já cadastrado." }, { status: 409 });
    }
    return Response.json({ lead: result.lead }, { status: 201 });
  } catch {
    return Response.json({ erro: "Não foi possível cadastrar o lead." }, { status: 500 });
  }
}
