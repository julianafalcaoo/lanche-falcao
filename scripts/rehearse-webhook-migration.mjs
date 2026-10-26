import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";

const source = new URL(process.env.DATABASE_URL);
if (!["localhost","127.0.0.1","[::1]"].includes(source.hostname)||source.port!=="5433"||source.pathname!=="/lanche_falcao") throw new Error("Ensaio restrito ao banco local.");
const database=`lf_auth_test_${randomBytes(12).toString("hex")}`;
const admin=new pg.Client({connectionString:source.href});
let created=false, clone;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`); created=true;
  const restore=spawnSync("docker",["compose","exec","-T","postgres","sh","-c",'pg_restore -U "$POSTGRES_USER" --exit-on-error --dbname="$1" /tmp/lanche-falcao-pre-webhook-20261025.dump',"restore",database],{encoding:"utf8"});
  if(restore.status!==0) throw new Error("Restauração do backup falhou.");
  const target=new URL(source); target.pathname=`/${database}`;
  const env={...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href};
  const deploy=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{env,encoding:"utf8"});
  if(deploy.status!==0) throw new Error("Migration falhou na cópia restaurada.");
  clone=new pg.Client({connectionString:target.href}); await clone.connect();
  const baseline=JSON.parse(readFileSync("backups/pre-webhook-20261025.json","utf8"));
  for(const [table,expected] of Object.entries(baseline)) {
    const projection=table==="TentativaPagamento"?`to_jsonb(t) - ARRAY['statusLocal','metodoExterno','tipoMetodoExterno','reconciliadaEm','atualizadaNoProvedor']`:"to_jsonb(t)";
    const actual=(await clone.query(`SELECT count(*)::int AS quantidade, md5(coalesce(string_agg((${projection})::text, '|' ORDER BY id), '')) AS fingerprint FROM "${table}" t`)).rows[0];
    if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(`Registros divergentes no ensaio: ${table}`);
  }
  const invalid=(await clone.query(`SELECT count(*)::int AS n FROM "TentativaPagamento" WHERE "statusLocal" IS DISTINCT FROM 'APROVADO'::"StatusPagamento"`)).rows[0].n;
  if(invalid!==0) throw new Error("Backfill divergente dos estados aprovados esperados.");
  console.log("Backup restaurado, migration ensaiada e todos os campos anteriores preservados na cópia isolada.");
} catch { console.error("Ensaio falhou. Não aplicar a migration no banco principal."); process.exitCode=1; }
finally {
  await clone?.end();
  if(created && /^lf_auth_test_[a-f0-9]{24}$/.test(database)) await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
}
