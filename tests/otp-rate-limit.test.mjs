import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { reserveOtpQuota, otpClientIp } from "../src/server/auth/otp-rate-limit.ts";
import { POST } from "../src/app/api/auth/otp/solicitar/route.ts";

const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!/^lf_auth_test_[a-f0-9]{24}$/.test(database) || database !== process.env.AUTH_TEST_DATABASE) throw new Error("Exige PostgreSQL local descartável.");
const secret = "unit-only-secret-32-characters-minimum";
const phone = "+5592999999999";
function request(ip = "198.51.100.1", telefone = phone, extra = {}) {
  return new Request("https://app.invalid/api/auth/otp/solicitar", { method: "POST", headers: { origin: "https://app.invalid", "content-type": "application/json", "x-forwarded-for": ip, ...extra }, body: JSON.stringify({ nome: "Teste", telefone }) });
}
const key = (policy, identity) => createHmac("sha256", secret).update(`${policy}:${identity}`).digest("hex");
async function expire(policy, identity) { await prisma.limiteOtp.update({ where: { chave: key(policy, identity) }, data: { expiraEm: new Date(0) } }); }
beforeEach(async t => {
  for (const name of ["VERCEL", "INFOBIP_ALLOWED_PHONES", "OTP_RATE_LIMIT_SECRET", "INFOBIP_API_BASE_URL", "INFOBIP_API_KEY", "INFOBIP_2FA_APPLICATION_ID", "INFOBIP_2FA_MESSAGE_ID"]) {
    const old = process.env[name];t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
  Object.assign(process.env, { VERCEL: "1", OTP_RATE_LIMIT_SECRET: secret, INFOBIP_API_BASE_URL: "https://unit.api.infobip.com", INFOBIP_API_KEY: "fake", INFOBIP_2FA_APPLICATION_ID: "unit", INFOBIP_2FA_MESSAGE_ID: "unit" });
  delete process.env.INFOBIP_ALLOWED_PHONES;
  t.mock.method(globalThis, "fetch", async () => Response.json({ pinId: randomUUID(), smsStatus: "MESSAGE_SENT" }));
  await prisma.limiteOtp.deleteMany();await prisma.desafioOtp.deleteMany();
});
after(() => prisma.$disconnect());

test("Vercel sem allowlist aceita brasileiro válido e mantém cooldown persistido", async () => {
  assert.equal((await POST(request())).status, 200);
  const response = await POST(request("198.51.100.2", "(92) 99999-9999"));
  assert.equal(response.status, 429);assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("cache-control"), "no-store");assert.equal(fetch.mock.callCount(), 1);
  assert.equal(await prisma.limiteOtp.count(), 6);
  const independent = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try { assert.equal((await independent.limiteOtp.findUniqueOrThrow({ where: { chave: key("phone-minute", phone) } })).quantidade, 1); } finally { await independent.$disconnect(); }
});
test("concorrência do mesmo telefone envia um único SMS", async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => POST(request(`198.51.100.${i + 1}`))));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 429).length, 11);assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await prisma.limiteOtp.findUniqueOrThrow({ where: { chave: key("global-day", "global") } })).quantidade, 1);
});
test("IP limita telefones diferentes sob concorrência e tentativas recusadas são revertidas", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => POST(request("198.51.100.1", `+55929999999${90 + i}`))));
  assert.equal(results.filter(r => r.status === 200).length, 5);assert.equal(results.filter(r => r.status === 429).length, 3);
  assert.equal(fetch.mock.callCount(), 5);
  assert.equal((await prisma.limiteOtp.findUniqueOrThrow({ where: { chave: key("global-day", "global") } })).quantidade, 5);
});
test("quota diária por telefone persiste após expirar cooldown", async () => {
  for (let i = 0; i < 5; i++) { await reserveOtpQuota(phone, request(`198.51.100.${i + 1}`));await expire("phone-minute", phone); }
  await assert.rejects(reserveOtpQuota(phone, request("198.51.100.10")), { status: 429 });
  await expire("phone-day", phone);await reserveOtpQuota(phone, request("198.51.100.10"));
});
for (const [policy, identity, limit] of [["global-minute", "global", 10], ["global-day", "global", 100], ["ip-day", "198.51.100.1", 20]]) {
  test(`${policy} bloqueia mesmo com telefone novo e renova após expirar`, async () => {
    await prisma.limiteOtp.create({ data: { chave: key(policy, identity), quantidade: limit, expiraEm: new Date(Date.now() + 86400000) } });
    assert.equal((await POST(request())).status, 429);assert.equal(fetch.mock.callCount(), 0);
    await expire(policy, identity);assert.equal((await POST(request())).status, 200);
  });
}
test("timeout de envio consome cota e não repete automaticamente", async () => {
  fetch.mock.mockImplementation(async () => { throw new Error("simulated timeout"); });
  assert.equal((await POST(request())).status, 503);assert.equal((await POST(request())).status, 429);assert.equal(fetch.mock.callCount(), 1);
});
test("falha do banco bloqueia SMS sem vazar diagnóstico", async t => {
  const original = prisma.$transaction;prisma.$transaction = t.mock.fn(async () => { throw new Error("private database detail"); });t.after(() => { prisma.$transaction = original; });
  const response = await POST(request());assert.equal(response.status, 503);assert.equal((await response.text()).includes("private"), false);assert.equal(fetch.mock.callCount(), 0);
});
test("IP confiável e segredo obrigatórios; headers alternativos não contornam bloqueio", async () => {
  for (const ip of ["", "invalid", "198.51.100.1, 198.51.100.2"]) assert.equal((await POST(request(ip, phone, { "x-real-ip": "198.51.100.3" }))).status, 503);
  delete process.env.OTP_RATE_LIMIT_SECRET;assert.equal((await POST(request())).status, 503);assert.equal(fetch.mock.callCount(), 0);
});
test("IPv6 canônico agrega /64 e normaliza IPv4 mapeado", () => {
  assert.equal(otpClientIp(request("2001:db8::1")), otpClientIp(request("2001:0db8:0000:0000::abcd")));
  assert.equal(otpClientIp(request("::ffff:198.51.100.1")), otpClientIp(request()));
});
test("allowlist configurada continua restritiva; entrada inválida não envia SMS", async () => {
  process.env.INFOBIP_ALLOWED_PHONES = "+5511999999999";assert.equal((await POST(request())).status, 403);
  process.env.INFOBIP_ALLOWED_PHONES = "invalid";assert.equal((await POST(request())).status, 503);
  delete process.env.INFOBIP_ALLOWED_PHONES;assert.equal((await POST(request("198.51.100.1", "+12025550123"))).status, 422);
  assert.equal(fetch.mock.callCount(), 0);assert.equal(await prisma.limiteOtp.count(), 0);
});
