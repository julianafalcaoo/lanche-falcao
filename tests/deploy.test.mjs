import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
process.env.DATABASE_URL="postgresql://localhost:1/deploy_unit";
const { databaseOptions }=await import("../src/server/database/config.ts");
const { assertOtpAccess }=await import("../src/server/auth/otp-access.ts");
const { solicitarDesafio }=await import("../src/server/auth/service.ts");
const { prisma }=await import("../src/lib/prisma.ts");
const { GET, POST }=await import("../src/app/api/interno/pagamentos/reconciliar/route.ts");
const { sessionCookie, sessionCookieName }=await import("../src/server/auth/session.ts");
function env(t,key,value){const before=process.env[key];if(value===undefined) delete process.env[key];else process.env[key]=value;t.after(()=>{if(before===undefined)delete process.env[key];else process.env[key]=before;});}
beforeEach(t=>{
  for(const key of ["VERCEL","DATABASE_POOL_MAX","INFOBIP_ALLOWED_PHONES","CRON_SECRET","MERCADO_PAGO_RECONCILIACAO_SECRET"])env(t,key,undefined);
  env(t,"NODE_ENV","test");
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("Rede externa proibida");});
});
after(()=>prisma.$disconnect());
test("Node 24 padronizado e build não executa migrations",()=>{
  const pkg=JSON.parse(readFileSync("package.json","utf8"));
  assert.equal(pkg.engines.node,"24.x");assert.equal(readFileSync(".nvmrc","utf8").trim(),"24");
  assert.equal(pkg.scripts.build,"prisma generate && next build");
  const config=JSON.parse(readFileSync("vercel.json","utf8"));
  assert.deepEqual(config.crons,[{path:"/api/interno/pagamentos/reconciliar",schedule:"0 8 * * *"}]);
});
test("pool de produção é pequeno e mantém TLS sem overrides inseguros",t=>{
  env(t,"NODE_ENV","production");const options=databaseOptions();
  assert.equal(options.max,3);assert.equal(options.ssl,undefined);assert.equal(options.idleTimeoutMillis,10000);
  assert.equal(options.maxLifetimeSeconds,300);
});
test("limite de pool configurável e valores excessivos recusados",t=>{
  env(t,"DATABASE_POOL_MAX","5");assert.equal(databaseOptions().max,5);
  process.env.DATABASE_POOL_MAX="100";assert.throws(databaseOptions,/DATABASE_POOL_MAX/);
});
test("Vercel exige PostgreSQL remoto com TLS e erro não revela URL",t=>{
  env(t,"VERCEL","1");env(t,"DATABASE_URL","postgresql://database.invalid/test");
  assert.throws(databaseOptions,error=>!error.message.includes("database.invalid"));
  process.env.DATABASE_URL="postgresql://database.invalid/test?sslmode=require";
  assert.equal(databaseOptions().connectionTimeoutMillis,10000);
  process.env.DATABASE_URL="postgresql://localhost/test?sslmode=require";assert.throws(databaseOptions);
});
test("runtime ignora DIRECT_URL e usa somente DATABASE_URL",t=>{
  env(t,"DIRECT_URL","postgresql://different.invalid/migrations");
  assert.equal(databaseOptions().connectionString,process.env.DATABASE_URL);
});
test("OTP hospedado sem allowlist permite telefone, mas exige proteção de cota",async t=>{
  env(t,"VERCEL","1");
  env(t,"OTP_RATE_LIMIT_SECRET",undefined);
  assert.doesNotThrow(()=>assertOtpAccess("+5592999999999"));
  await assert.rejects(solicitarDesafio("Teste","92999999999"),{status:503});
  assert.equal(fetch.mock.callCount(),0);
});
test("allowlist normaliza telefone e recusa outros destinatários",t=>{
  env(t,"VERCEL","1");env(t,"INFOBIP_ALLOWED_PHONES","(92) 99999-9999");
  assert.doesNotThrow(()=>assertOtpAccess("+5592999999999"));
  assert.throws(()=>assertOtpAccess("+5511999999999"),{code:"TELEFONE_NAO_PERMITIDO"});
  process.env.INFOBIP_ALLOWED_PHONES="invalid";assert.throws(()=>assertOtpAccess("+5592999999999"),{code:"CONFIGURACAO_OTP_INVALIDA"});
});
test("desenvolvimento mantém OTP existente quando allowlist omitida",()=>assert.doesNotThrow(()=>assertOtpAccess("+5592999999999")));
test("cookie de homologação usa flags de produção e prefixo Host",t=>{
  env(t,"NODE_ENV","production");const cookie=sessionCookie("token",new Date(Date.now()+10000));
  assert.equal(sessionCookieName(),"__Host-lf_session");
  for(const flag of ["HttpOnly","Secure","SameSite=Lax","Path=/"])assert.ok(cookie.includes(flag));
  assert.equal(cookie.includes("Domain="),false);
});
test("cron GET falha fechado, não aceita o segredo do POST",async t=>{
  assert.equal((await GET(new Request("https://app.invalid/api/cron"))).status,503);
  env(t,"CRON_SECRET","unit-cron");env(t,"MERCADO_PAGO_RECONCILIACAO_SECRET","unit-post");
  for(const headers of [{},{authorization:"Bearer invalid"},{cookie:"CRON_SECRET=unit-cron",origin:"https://app.invalid","user-agent":"vercel-cron/1.0"}]){
    const response=await GET(new Request("https://app.invalid/api/cron?secret=unit-cron",{headers}));
    assert.equal(response.status,401);assert.equal(response.headers.get("cache-control"),"no-store");
  }
  assert.equal((await GET(new Request("https://app.invalid/api/cron",{headers:{authorization:"Bearer unit-post"}}))).status,401);
  assert.equal((await POST(new Request("https://app.invalid/api/cron",{method:"POST",headers:{authorization:"Bearer unit-cron"}}))).status,401);
});
test("cron GET e POST autenticados executam lote sem cache",async t=>{
  env(t,"CRON_SECRET","unit-cron");env(t,"MERCADO_PAGO_RECONCILIACAO_SECRET","unit-post");
  env(t,"MERCADO_PAGO_ACCESS_TOKEN","fake-private");env(t,"MERCADO_PAGO_PUBLIC_KEY","fake-public");env(t,"MERCADO_PAGO_AMBIENTE","test");
  for(const model of ["tentativaPagamento","webhookOrder"]){const original=prisma[model].findMany;prisma[model].findMany=t.mock.fn(async()=>[]);t.after(()=>{prisma[model].findMany=original;});}
  for(const [handler,secret] of [[GET,"unit-cron"],[POST,"unit-post"]]){
    const response=await handler(new Request("https://app.invalid/api/cron",{headers:{authorization:`Bearer ${secret}`}}));
    assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
  }
  assert.equal(fetch.mock.callCount(),0);
});
