import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";

class SetupError extends Error {}
const envPath = new URL("../.env", import.meta.url);
const lockPath = new URL("../.env.infobip-setup.lock", import.meta.url);
const applicationConfig = {
  name: "Lanche Falcao",
  enabled: true,
  configuration: {
    pinAttempts: 5,
    allowMultiplePinVerifications: false,
    pinTimeToLive: "5m",
    verifyPinLimit: "1/3s",
    sendPinPerApplicationLimit: "1000/1d",
    sendPinPerPhoneNumberLimit: "5/1d",
  },
};
const messageConfig = {
  pinType: "NUMERIC",
  pinLength: 4,
  messageText: "Seu codigo de verificacao do Lanche Falcao e {{pin}}",
  senderId: "ServiceSMS",
};

function safe(value) {
  let text = String(value ?? "");
  for (const secret of [process.env.INFOBIP_API_KEY, process.env.DATABASE_URL]) {
    if (secret) text = text.split(secret).join("[REMOVIDO]");
  }
  return text.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 1000);
}
function validId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new SetupError("ID retornado/configurado inválido; nenhuma nova criação será tentada.");
  return value;
}
function saveId(name, value) {
  validId(value);
  const current = readFileSync(envPath, "utf8");
  const expression = new RegExp("^" + name + "\\s*=.*$", "gm");
  const line = name + "=" + value;
  const updated = expression.test(current) ? current.replace(expression, () => line) : current + (current.endsWith("\n") ? "" : "\n") + line + "\n";
  writeFileSync(envPath, updated, { mode: 0o600 });
  process.env[name] = value;
}
function validateApplication(app) {
  if (app?.name !== applicationConfig.name || app?.enabled !== true ||
    Object.entries(applicationConfig.configuration).some(([key, value]) => app.configuration?.[key] !== value)) {
    throw new SetupError("A aplicação existente difere da configuração desejada. Nenhum recurso duplicado foi criado; revise a aplicação no painel.");
  }
}
function validateMessage(message) {
  if (Object.entries(messageConfig).some(([key, value]) => message?.[key] !== value)) {
    throw new SetupError("O template existente difere de ServiceSMS/NUMERIC/4/texto solicitado. Nenhum template duplicado foi criado.");
  }
}
async function main() {
  loadEnvFile(envPath);
  if (!process.env.INFOBIP_API_KEY?.trim() || !process.env.INFOBIP_API_BASE_URL?.trim()) throw new SetupError("Configure INFOBIP_API_BASE_URL e INFOBIP_API_KEY no .env.");
  let base;
  try { base = new URL(process.env.INFOBIP_API_BASE_URL); } catch { throw new SetupError("INFOBIP_API_BASE_URL inválida."); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/" ||
    !(base.hostname === "api.infobip.com" || base.hostname.endsWith(".api.infobip.com"))) {
    throw new SetupError("A Base URL deve ser a origem HTTPS da API Infobip, sem credenciais, caminho ou parâmetros.");
  }
  async function api(method, path, body) {
    let response;
    try {
      response = await fetch(new URL(path, base), {
        method, redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { Authorization: `App ${process.env.INFOBIP_API_KEY}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new SetupError(`${method} ${path}: falha de rede/timeout. Não houve repetição automática; confira recursos existentes antes de tentar novamente.`);
    }
    let data;
    try { data = await response.json(); } catch {
      throw new SetupError(`${method} ${path}: HTTP ${response.status}, resposta não JSON. Operação interrompida sem repetição.`);
    }
    if (!response.ok) {
      const details = data?.requestError?.serviceException ?? data?.requestError?.policyException ?? data;
      throw new SetupError(`${method} ${path}: HTTP ${response.status}; código: ${safe(details?.messageId ?? details?.errorCode ?? details?.code ?? "não informado")}; mensagem: ${safe(details?.text ?? details?.message ?? "não informada")}.`);
    }
    return data;
  }
  const applications = await api("GET", "/2fa/2/applications");
  if (!Array.isArray(applications)) throw new SetupError("Lista de aplicações em formato inesperado; criação cancelada.");
  console.log("Comunicação autenticada com Infobip: OK.");
  let applicationId = process.env.INFOBIP_2FA_APPLICATION_ID?.trim();
  let messageId = process.env.INFOBIP_2FA_MESSAGE_ID?.trim();
  if (!applicationId) {
    const matches = applications.filter((app) => app.name === applicationConfig.name);
    if (matches.length > 1) throw new SetupError("Há mais de uma aplicação Lanche Falcao. Configure o ID correto antes de continuar.");
    if (matches.length === 1) applicationId = validId(matches[0].applicationId);
  }
  const checkOnly = process.argv.includes("--check");
  if (!applicationId) {
    if (messageId) throw new SetupError("Há messageId sem aplicação identificável. Configure INFOBIP_2FA_APPLICATION_ID; nenhum recurso foi criado.");
    if (checkOnly) { console.log("Aplicação ainda não encontrada; nenhuma criação executada (--check)."); return; }
    const created = await api("POST", "/2fa/2/applications", applicationConfig);
    applicationId = validId(created.applicationId);
    saveId("INFOBIP_2FA_APPLICATION_ID", applicationId);
    console.log("Aplicação criada. applicationId:", safe(applicationId));
  }
  const appPath = `/2fa/2/applications/${validId(applicationId)}`;
  const app = await api("GET", appPath);
  validateApplication(app);
  if (!checkOnly) saveId("INFOBIP_2FA_APPLICATION_ID", applicationId);
  const messages = await api("GET", appPath + "/messages");
  if (!Array.isArray(messages)) throw new SetupError("Lista de templates em formato inesperado; criação cancelada.");
  if (!messageId) {
    const matches = messages.filter((message) => message.messageText === messageConfig.messageText);
    if (matches.length > 1) throw new SetupError("Há templates com o mesmo texto. Configure o messageId correto antes de continuar.");
    if (matches.length === 1) messageId = validId(matches[0].messageId);
  }
  if (!messageId) {
    if (checkOnly) { console.log("Aplicação válida; template ainda não encontrado. Nenhuma criação executada (--check)."); return; }
    const created = await api("POST", appPath + "/messages", messageConfig);
    messageId = validId(created.messageId);
    saveId("INFOBIP_2FA_MESSAGE_ID", messageId);
    console.log("Template criado. messageId:", safe(messageId));
  }
  const message = await api("GET", appPath + "/messages/" + validId(messageId));
  validateMessage(message);
  if (!checkOnly) saveId("INFOBIP_2FA_MESSAGE_ID", messageId);
  console.log(JSON.stringify({
    applicationId, messageId,
    applicationConfiguration: Object.fromEntries(Object.keys(applicationConfig.configuration).map((key) => [key, app.configuration[key]])),
    senderId: message.senderId, pinType: message.pinType, pinLength: message.pinLength,
    messageText: message.messageText,
    checkedOnly: checkOnly,
  }, null, 2));
  console.log("Configuração validada por leitura da API. Nenhum SMS foi enviado.");
}
let lock;
try {
  try { lock = openSync(lockPath, "wx", 0o600); } catch { throw new SetupError("Configuração já em execução ou lock indisponível. Nenhuma chamada foi realizada."); }
  await main();
} catch (error) {
  console.error(error instanceof SetupError ? safe(error.message) : "Falha local ao configurar Infobip. Operação interrompida sem expor detalhes ou credenciais.");
  process.exitCode = 1;
} finally {
  if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
}
