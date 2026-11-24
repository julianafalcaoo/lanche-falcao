export interface CurrentCustomer { nome: string; telefone: string }

const messages: Record<string, string> = {
  NOME_INVALIDO: "Informe um nome de até 100 caracteres.",
  TELEFONE_INVALIDO: "Confira o celular e o DDD informado.",
  CODIGO_INVALIDO: "Digite os quatro números do código recebido.",
  CODIGO_INCORRETO: "Código incorreto. Confira o SMS e tente novamente.",
  CODIGO_EXPIRADO: "O código expirou. Solicite um novo código.",
  DESAFIO_EXPIRADO: "O código expirou. Solicite um novo código.",
  TENTATIVAS_ESGOTADAS: "O limite de tentativas foi atingido. Solicite um novo código.",
  DESAFIO_INVALIDO: "Não foi possível usar este código. Solicite um novo código.",
  DESAFIO_INDISPONIVEL: "Este código já foi utilizado ou está indisponível. Solicite um novo código.",
  LIMITE_EXCEDIDO: "Limite de solicitações atingido. Aguarde antes de tentar novamente.",
};
export class CustomerApiError extends Error {
  code: string;
  constructor(code: string) {
    super(messages[code] ?? "Não foi possível continuar agora. Tente novamente mais tarde.");
    this.code = code;
  }
}

export async function customerRequest(path: string, body?: object, signal?: AbortSignal) {
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: signal ?? AbortSignal.timeout(20000),
    });
    if (path === "me" && response.status === 401) return null;
    const data = await response.json();
    if (!response.ok) throw new CustomerApiError(typeof data?.erro === "string" ? data.erro : "INDISPONIVEL");
    return data;
  } catch (error) {
    if (error instanceof CustomerApiError) throw error;
    throw new CustomerApiError("INDISPONIVEL");
  }
}

export async function loadCustomer(signal?: AbortSignal): Promise<CurrentCustomer | null> {
  const data = await customerRequest("me", undefined, signal);
  if (data === null) return null;
  if (data?.autenticado !== true || typeof data.cliente?.nome !== "string" || typeof data.cliente?.telefone !== "string") {
    throw new CustomerApiError("INDISPONIVEL");
  }
  return { nome: data.cliente.nome, telefone: data.cliente.telefone };
}

export function formatCellphone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  const number = digits.slice(2);
  return `(${digits.slice(0, 2)}) ${number.slice(0, 5)}${number.length > 5 ? `-${number.slice(5)}` : ""}`;
}
