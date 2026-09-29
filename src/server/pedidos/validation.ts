import "server-only";
import type { DeliveryAddress } from "../../types/checkout.ts";

export class PedidoError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message); this.code = code; this.status = status;
  }
}
export const MAX_QUANTITY = 100;
export const MAX_ITEMS = 100;
export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new PedidoError("CAMPOS_INVALIDOS", 422, "A solicitação contém campos não permitidos.");
}
function address(value: unknown): DeliveryAddress {
  if (!object(value)) throw new PedidoError("ENDERECO_INVALIDO", 422, "Informe o endereço de entrega.");
  const keys = ["postalCode", "street", "number", "neighborhood", "city", "state", "complement", "reference"] as const;
  onlyKeys(value, [...keys]);
  const result = {} as DeliveryAddress;
  for (const key of keys) {
    const optional = key === "complement" || key === "reference";
    const field = value[key] ?? (optional ? "" : null);
    if (typeof field !== "string" || (!optional && !field.trim()) || field.trim().length > 200 || /[\x00-\x1f\x7f]/.test(field)) {
      throw new PedidoError("ENDERECO_INVALIDO", 422, "Confira os campos do endereço de entrega.");
    }
    result[key] = field.trim();
  }
  if (!/^\d{5}-?\d{3}$/.test(result.postalCode) || !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(result.state.toUpperCase())) {
    throw new PedidoError("ENDERECO_INVALIDO", 422, "Informe CEP e UF válidos.");
  }
  result.postalCode = result.postalCode.replace("-", "");
  result.state = result.state.toUpperCase();
  return result;
}

export function parsePedido(value: unknown): {
  tipo: "RETIRADA" | "ENTREGA";
  itens: { productId: string; quantity: number }[];
  endereco: DeliveryAddress | null;
} {
  if (!object(value)) throw new PedidoError("PEDIDO_INVALIDO", 400, "Envie um objeto JSON válido.");
  onlyKeys(value, ["tipo", "itens", "endereco"]);
  if (value.tipo !== "RETIRADA" && value.tipo !== "ENTREGA") throw new PedidoError("TIPO_INVALIDO", 422, "Escolha RETIRADA ou ENTREGA.");
  if (!Array.isArray(value.itens) || !value.itens.length || value.itens.length > MAX_ITEMS) throw new PedidoError("ITENS_INVALIDOS", 422, "Informe de 1 a 100 produtos distintos.");
  const ids = new Set<string>();
  const itens = value.itens.map((item: unknown) => {
    if (!object(item)) throw new PedidoError("ITEM_INVALIDO", 422, "Informe produto e quantidade para cada item.");
    onlyKeys(item, ["productId", "quantity"]);
    if (typeof item.productId !== "string" || !/^[a-z0-9-]{1,100}$/.test(item.productId)) throw new PedidoError("PRODUTO_INVALIDO", 422, "Produto inválido.");
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) throw new PedidoError("QUANTIDADE_INVALIDA", 422, "A quantidade deve ser um inteiro entre 1 e 100.");
    if (ids.has(item.productId)) throw new PedidoError("PRODUTO_REPETIDO", 422, "Envie uma única linha por produto.");
    ids.add(item.productId);
    return { productId: item.productId, quantity: item.quantity };
  }).sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
  if (value.tipo === "RETIRADA" && value.endereco != null) throw new PedidoError("ENDERECO_INVALIDO", 422, "Não envie endereço para retirada.");
  return { tipo: value.tipo, itens, endereco: value.tipo === "ENTREGA" ? address(value.endereco) : null };
}

export function parseKey(value: string | null) {
  if (!isUuid(value)) throw new PedidoError("IDEMPOTENCIA_INVALIDA", 400, "Envie uma chave UUID no cabeçalho Idempotency-Key.");
  return value.toLowerCase();
}

export function parsePage(url: string) {
  const query = new URL(url).searchParams;
  if ([...query.keys()].some((key) => !["limite", "cursor"].includes(key)) || query.getAll("limite").length > 1 || query.getAll("cursor").length > 1) throw new PedidoError("PAGINACAO_INVALIDA", 400, "Parâmetros de paginação inválidos.");
  const raw = query.get("limite") ?? "20";
  const cursor = query.get("cursor");
  if (!/^[1-9]\d?$/.test(raw) || Number(raw) > 50 || (cursor !== null && !isUuid(cursor))) throw new PedidoError("PAGINACAO_INVALIDA", 400, "Use limite entre 1 e 50 e um cursor válido.");
  return { limite: Number(raw), cursor: cursor?.toLowerCase() ?? null };
}
