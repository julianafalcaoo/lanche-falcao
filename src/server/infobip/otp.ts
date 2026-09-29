import "server-only";
import { normalizarTelefoneBrasileiro } from "../../lib/telefone.ts";

const errors = {
  CONFIGURACAO_OTP_INVALIDA: [503, "Serviço de SMS não configurado corretamente."],
  PROVEDOR_INDISPONIVEL: [503, "Não foi possível consultar o serviço de SMS agora."],
  RESPOSTA_PROVEDOR_INVALIDA: [502, "O serviço de SMS retornou uma resposta inesperada."],
  ENVIO_REJEITADO: [502, "O serviço de SMS não aceitou o envio."],
  LIMITE_EXCEDIDO: [429, "Limite de solicitações atingido. Aguarde antes de tentar novamente."],
  CODIGO_INCORRETO: [422, "Código incorreto."],
  CODIGO_EXPIRADO: [410, "Código expirado."],
  TENTATIVAS_ESGOTADAS: [429, "Limite de tentativas deste código atingido."],
  DESAFIO_INVALIDO: [404, "Desafio de verificação inválido."],
  VERIFICACAO_RECUSADA: [422, "Não foi possível validar este código."],
  TELEFONE_INVALIDO: [422, "Informe um telefone brasileiro válido com DDD."],
  PIN_ID_INVALIDO: [400, "Informe um pinId válido."],
  CODIGO_INVALIDO: [400, "Informe o código como texto com exatamente quatro dígitos."],
  JSON_INVALIDO: [400, "Envie um objeto JSON válido."],
} as const;

export class OtpError extends Error {
  readonly code: keyof typeof errors;
  readonly status: number;
  readonly providerStatus?: number;
  providerCode?: string;
  providerMessage?: string;
  constructor(code: keyof typeof errors, providerStatus?: number) {
    super(errors[code][1]);
    this.name = "OtpError";
    this.code = code;
    this.status = errors[code][0];
    this.providerStatus = providerStatus;
  }
}

function providerDiagnostic(error: OtpError, data: unknown, secrets: string[]) {
  if (!isObject(data)) return error;
  const requestError = data.requestError;
  if (!isObject(requestError)) return error;
  const detail = requestError.serviceException ?? requestError.policyException;
  if (!isObject(detail)) return error;
  const redact = (value: string) => {
    let safe = value;
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      safe = safe.split(secret).join("[redigido]");
      safe = safe.split(encodeURIComponent(secret)).join("[redigido]");
    }
    return safe.replace(/https?:\/\/\S+|postgres(?:ql)?:\/\/\S+/gi, "[URL redigida]")
      .replace(/(?:\+?\d[\s().-]*){4,}/g, "[número redigido]")
      .replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, 400);
  };
  if (typeof detail.messageId === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(detail.messageId) &&
      !secrets.some((secret) => secret && detail.messageId === secret)) error.providerCode = detail.messageId;
  if (typeof detail.text === "string") error.providerMessage = redact(detail.text);
  return error;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validPinId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function config() {
  const base = process.env.INFOBIP_API_BASE_URL;
  const apiKey = process.env.INFOBIP_API_KEY;
  const applicationId = process.env.INFOBIP_2FA_APPLICATION_ID;
  const messageId = process.env.INFOBIP_2FA_MESSAGE_ID;
  try {
    if (!base || !apiKey?.trim() || /[\r\n]/.test(apiKey) ||
        !validPinId(applicationId) || !validPinId(messageId)) throw new Error();
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.pathname !== "/" || url.search || url.hash ||
        !(url.hostname === "api.infobip.com" || url.hostname.endsWith(".api.infobip.com"))) throw new Error();
    return { origin: url.origin, apiKey, applicationId, messageId };
  } catch {
    throw new OtpError("CONFIGURACAO_OTP_INVALIDA");
  }
}

async function post(path: string, body: object, settings: ReturnType<typeof config>, verifying = false) {
  try {
    const response = await fetch(`${settings.origin}${path}`, {
      method: "POST",
      headers: { Authorization: `App ${settings.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const code = response.status === 429 ? "LIMITE_EXCEDIDO" :
        verifying && response.status === 404 ? "DESAFIO_INVALIDO" :
        response.status >= 500 ? "PROVEDOR_INDISPONIVEL" : "ENVIO_REJEITADO";
      const error = new OtpError(code, response.status);
      const details: unknown = await response.json().catch(() => null);
      throw providerDiagnostic(error, details, [settings.apiKey, process.env.DATABASE_URL ?? "", ...Object.values(body).filter((v): v is string => typeof v === "string")]);
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new OtpError("RESPOSTA_PROVEDOR_INVALIDA", response.status); }
    if (!isObject(data)) throw new OtpError("RESPOSTA_PROVEDOR_INVALIDA", response.status);
    return data;
  } catch (error) {
    if (error instanceof OtpError) throw error;
    throw new OtpError("PROVEDOR_INDISPONIVEL");
  }
}

export async function solicitarOtp(value: unknown) {
  const telefone = normalizarTelefoneBrasileiro(value);
  if (!telefone) throw new OtpError("TELEFONE_INVALIDO");
  const settings = config();
  const data = await post("/2fa/2/pin", {
    applicationId: settings.applicationId, messageId: settings.messageId, to: telefone,
  }, settings);
  if (data.smsStatus !== "MESSAGE_SENT") throw new OtpError("ENVIO_REJEITADO");
  if (!validPinId(data.pinId)) throw new OtpError("RESPOSTA_PROVEDOR_INVALIDA");
  return { enviado: true, pinId: data.pinId };
}

export async function verificarOtp(pinId: unknown, codigo: unknown) {
  if (!validPinId(pinId)) throw new OtpError("PIN_ID_INVALIDO");
  if (typeof codigo !== "string" || !/^[0-9]{4}$/.test(codigo)) throw new OtpError("CODIGO_INVALIDO");
  const data = await post(`/2fa/2/pin/${encodeURIComponent(pinId)}/verify`, { pin: codigo }, config(), true);
  if (data.pinId !== pinId || typeof data.verified !== "boolean") throw new OtpError("RESPOSTA_PROVEDOR_INVALIDA");
  if (data.verified === true && !data.pinError) return { verificado: true };
  if (data.verified === true) throw new OtpError("RESPOSTA_PROVEDOR_INVALIDA");
  switch (data.pinError) {
    case "TTL_EXPIRED": throw new OtpError("CODIGO_EXPIRADO");
    case "NO_MORE_PIN_ATTEMPTS": throw new OtpError("TENTATIVAS_ESGOTADAS");
    case "WRONG_PIN": throw new OtpError("CODIGO_INCORRETO");
    default: throw new OtpError("VERIFICACAO_RECUSADA");
  }
}
