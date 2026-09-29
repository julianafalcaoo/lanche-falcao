import { normalizarTelefoneBrasileiro } from "../../../../lib/telefone.ts";
import { buscarClientePorTelefone } from "../../../../server/clientes/repository.ts";

export const runtime = "nodejs";

function json(body: object, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ erro: "JSON_INVALIDO", mensagem: "Envie um corpo JSON válido." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !("telefone" in body) || typeof body.telefone !== "string") {
    return json({ erro: "TELEFONE_OBRIGATORIO", mensagem: "Informe telefone como texto." }, 400);
  }
  const telefone = normalizarTelefoneBrasileiro(body.telefone);
  if (!telefone) {
    return json({ erro: "TELEFONE_INVALIDO", mensagem: "Informe um telefone brasileiro válido com DDD." }, 422);
  }
  try {
    // Consultar não autentica. A existência do cadastro não altera a resposta pública.
    await buscarClientePorTelefone(telefone);
    return json({ telefone, podeProsseguirParaVerificacao: true }, 200);
  } catch {
    // Não incluir erro do driver, telefone ou credenciais na resposta ou em logs.
    return json({ erro: "SERVICO_INDISPONIVEL", mensagem: "Não foi possível continuar agora. Tente novamente mais tarde." }, 503);
  }
}
