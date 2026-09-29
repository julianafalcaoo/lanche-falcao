import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { solicitarOtp, verificarOtp, OtpError } from "../src/server/infobip/otp.ts";
import { otpBody, otpFailure, otpJson } from "../src/server/infobip/http.ts";

// Contrato do adaptador Infobip isolado; os handlers públicos são cobertos em auth.test.mjs.
async function solicitar(request) {
  try { const body = await otpBody(request); return otpJson(await solicitarOtp(body.telefone)); }
  catch (error) { return otpFailure(error); }
}
async function verificar(request) {
  try { const body = await otpBody(request); return otpJson(await verificarOtp(body.pinId, body.codigo)); }
  catch (error) { return otpFailure(error); }
}

const pinId = "challenge-test-01";
const fake = {
  INFOBIP_API_BASE_URL: "https://unit-test.api.infobip.com",
  INFOBIP_API_KEY: "fake-key-only-for-tests",
  INFOBIP_2FA_APPLICATION_ID: "app-test",
  INFOBIP_2FA_MESSAGE_ID: "message-test",
};
let original;
beforeEach((t) => {
  original = Object.fromEntries(Object.keys(fake).map((key) => [key, process.env[key]]));
  Object.assign(process.env, fake);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Rede proibida no teste"); });
});
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const request = (body) => new Request("http://localhost/api/auth/otp", {
  method: "POST", headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function provider(body, status = 200) {
  globalThis.fetch.mock.mockImplementation(async () => Response.json(body, { status }));
}
async function check(response, status, error) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  const data = await response.json();
  if (error) assert.equal(data.erro, error);
  return data;
}

test("normaliza telefone e envia uma única requisição com contrato oficial", async () => {
  provider({ pinId, smsStatus: "MESSAGE_SENT", to: "+5592999999999" });
  assert.deepEqual(await check(await solicitar(request({ telefone: "(92) 99999-9999" })), 200), { enviado: true, pinId });
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, `${fake.INFOBIP_API_BASE_URL}/2fa/2/pin`);
  assert.deepEqual(JSON.parse(options.body), { applicationId: "app-test", messageId: "message-test", to: "+5592999999999" });
  assert.equal(options.headers.Authorization, `App ${fake.INFOBIP_API_KEY}`);
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
});

for (const telefone of [undefined, null, 123, "123", "+12025550123", "telefone"]) {
  test(`rejeita telefone inválido (${typeof telefone}/${String(telefone)}) sem rede`, async () => {
    await check(await solicitar(request({ telefone })), 422, "TELEFONE_INVALIDO");
    assert.equal(fetch.mock.callCount(), 0);
  });
}
for (const route of [solicitar, verificar]) {
  test(`body ausente, malformado e não objeto em ${route === solicitar ? "solicitar" : "verificar"}`, async () => {
    for (const body of [undefined, null, [], "texto"]) await check(await route(request(body)), 400, "JSON_INVALIDO");
    await check(await route(new Request("http://localhost", { method: "POST", body: "{" })), 400, "JSON_INVALIDO");
    assert.equal(fetch.mock.callCount(), 0);
  });
}
for (const codigo of ["123", "12345", "abcd", 1234, " 1234", "１２３４", null]) {
  test(`rejeita formato do código ${typeof codigo}/${String(codigo)}`, async () => {
    await check(await verificar(request({ pinId, codigo })), 400, "CODIGO_INVALIDO");
    assert.equal(fetch.mock.callCount(), 0);
  });
}
test("rejeita pinId ausente ou capaz de alterar o caminho", async () => {
  for (const id of [undefined, "", "../other", "a?b", 123, "x".repeat(129)]) {
    await check(await verificar(request({ pinId: id, codigo: "0123" })), 400, "PIN_ID_INVALIDO");
  }
  assert.equal(fetch.mock.callCount(), 0);
});
test("PIN correto preserva zero inicial e retorna somente verificado", async () => {
  provider({ pinId, verified: true, attemptsRemaining: 0, msisdn: "+5592999999999" });
  assert.deepEqual(await check(await verificar(request({ pinId, codigo: "0123" })), 200), { verificado: true });
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, `${fake.INFOBIP_API_BASE_URL}/2fa/2/pin/${pinId}/verify`);
  assert.deepEqual(JSON.parse(options.body), { pin: "0123" });
});
for (const [pinError, status, code] of [
  ["WRONG_PIN", 422, "CODIGO_INCORRETO"],
  ["TTL_EXPIRED", 410, "CODIGO_EXPIRADO"],
  ["NO_MORE_PIN_ATTEMPTS", 429, "TENTATIVAS_ESGOTADAS"],
  ["UNKNOWN", 422, "VERIFICACAO_RECUSADA"],
]) {
  test(`interpreta ${pinError} sem repetir a chamada`, async () => {
    provider({ pinId, verified: false, pinError });
    await check(await verificar(request({ pinId, codigo: "0123" })), status, code);
    assert.equal(fetch.mock.callCount(), 1);
  });
}
for (const [status, local, code] of [[429, 429, "LIMITE_EXCEDIDO"], [500, 503, "PROVEDOR_INDISPONIVEL"], [401, 502, "ENVIO_REJEITADO"]]) {
  test(`HTTP ${status} não vaza corpo do provedor nem dispara retry`, async () => {
    provider({ secret: fake.INFOBIP_API_KEY, pin: "0123", telefone: "+5592999999999" }, status);
    const data = await check(await solicitar(request({ telefone: "92999999999" })), local, code);
    assert.deepEqual(Object.keys(data).sort(), ["erro", "mensagem"]);
    assert.equal(JSON.stringify(data).includes(fake.INFOBIP_API_KEY), false);
    assert.equal(JSON.stringify(data).includes("0123"), false);
    assert.equal(fetch.mock.callCount(), 1);
  });
}
test("404 na verificação identifica desafio inválido", async () => {
  provider({}, 404);
  await check(await verificar(request({ pinId, codigo: "0123" })), 404, "DESAFIO_INVALIDO");
});
test("resposta inesperada ou SMS rejeitado não vira sucesso", async () => {
  for (const body of [{ pinId, smsStatus: "MESSAGE_NOT_SENT" }, { smsStatus: "MESSAGE_SENT" }, null]) {
    provider(body);
    assert.equal((await solicitar(request({ telefone: "92999999999" }))).status, 502);
  }
  for (const body of [{ pinId, verified: "true" }, { pinId: "outro", verified: true }, { pinId, verified: true, pinError: "WRONG_PIN" }]) {
    provider(body);
    await check(await verificar(request({ pinId, codigo: "0123" })), 502, "RESPOSTA_PROVEDOR_INVALIDA");
  }
  fetch.mock.mockImplementation(async () => new Response("not JSON"));
  await check(await solicitar(request({ telefone: "92999999999" })), 502, "RESPOSTA_PROVEDOR_INVALIDA");
});
test("falha de rede é sanitizada e nunca reenvia", async () => {
  fetch.mock.mockImplementation(async () => { throw new Error(`${fake.INFOBIP_API_KEY} 0123`); });
  await check(await solicitar(request({ telefone: "92999999999" })), 503, "PROVEDOR_INDISPONIVEL");
  assert.equal(fetch.mock.callCount(), 1);
});
test("diagnóstico privado redige chave, PIN, telefone e URL e não aparece no HTTP", async () => {
  provider({ requestError: { serviceException: {
    messageId: "SVC0001",
    text: `Denied ${fake.INFOBIP_API_KEY} 0123 +5592999999999 https://secret.example/path`,
  } } }, 403);
  await assert.rejects(() => solicitarOtp("92999999999"), (error) => {
    assert.ok(error instanceof OtpError);
    assert.equal(error.providerStatus, 403);
    assert.equal(error.providerCode, "SVC0001");
    for (const secret of [fake.INFOBIP_API_KEY, "0123", "5592999999999", "secret.example"]) {
      assert.equal(error.providerMessage.includes(secret), false);
    }
    return true;
  });
  const data = await check(await solicitar(request({ telefone: "92999999999" })), 502, "ENVIO_REJEITADO");
  assert.deepEqual(Object.keys(data).sort(), ["erro", "mensagem"]);
  assert.equal(JSON.stringify(data).includes("SVC0001"), false);
});
test("configuração ausente ou origem insegura falha antes da rede", async () => {
  for (const key of Object.keys(fake)) {
    delete process.env[key];
    await check(await solicitar(request({ telefone: "92999999999" })), 503, "CONFIGURACAO_OTP_INVALIDA");
    process.env[key] = fake[key];
  }
  for (const base of ["http://unit-test.api.infobip.com", "https://example.com", "https://unit-test.api.infobip.com/other", "https://user:password@api.infobip.com"]) {
    process.env.INFOBIP_API_BASE_URL = base;
    await check(await solicitar(request({ telefone: "92999999999" })), 503, "CONFIGURACAO_OTP_INVALIDA");
  }
  assert.equal(fetch.mock.callCount(), 0);
});
