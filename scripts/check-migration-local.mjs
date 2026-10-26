import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.port !== "5433" || url.pathname !== "/lanche_falcao") {
  throw new Error("Auditoria restrita ao banco local de desenvolvimento.");
}
const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis:5000 });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const migrations = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at')).rows;
  for (const row of migrations) {
    if (!row.finished_at || row.rolled_back_at) throw new Error("Migration incompleta/revertida: revisar manualmente.");
    const checksum = createHash("sha256").update(readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`)).digest("hex");
    if (checksum !== row.checksum) throw new Error(`Migration aplicada diverge do arquivo: ${row.migration_name}`);
  }
  const pending = readdirSync("prisma/migrations", { withFileTypes:true }).filter(entry=>entry.isDirectory()&&!migrations.some(row=>row.migration_name===entry.name)).map(entry=>entry.name);
  const baseline = {};
  for (const table of ["Cliente", "DesafioOtp", "Sessao", "Pedido", "ItemPedido", "TentativaPagamento"]) {
    // Apenas fingerprints são persistidos; nenhum dado pessoal, token ou pagador é impresso.
    const projection = table === "TentativaPagamento" ? `to_jsonb(t) - ARRAY['statusLocal','metodoExterno','tipoMetodoExterno','reconciliadaEm','atualizadaNoProvedor']` : "to_jsonb(t)";
    baseline[table] = (await client.query(`SELECT count(*)::int AS quantidade, md5(coalesce(string_agg((${projection})::text, '|' ORDER BY id), '')) AS fingerprint FROM "${table}" t`)).rows[0];
  }
  const states = (await client.query('SELECT "statusExterno", "detalheExterno", "encerrada", count(*)::int AS quantidade FROM "TentativaPagamento" GROUP BY 1,2,3')).rows;
  console.log(JSON.stringify({ banco:"lanche_falcao", migrationsAplicadas:migrations.map(row=>row.migration_name), pendentes:pending, contagens:Object.fromEntries(Object.entries(baseline).map(([key,value])=>[key,value.quantidade])), estadosExistentes:states }));
  if (process.argv[2]) {
    const action=process.argv[2], path=process.argv[3];
    if (!path || !/^backups\/[a-zA-Z0-9_-]+\.json$/.test(path)) throw new Error("Caminho de auditoria deve ficar em backups/.");
    if(action==="save") writeFileSync(path, JSON.stringify(baseline,null,2),{flag:"wx"});
    else if(action==="compare") {
      if(JSON.stringify(JSON.parse(readFileSync(path,"utf8")))!==JSON.stringify(baseline)) throw new Error("Dados existentes divergiram do baseline. Interromper e investigar.");
      console.log("Todos os registros e campos anteriores permanecem idênticos ao baseline.");
    } else throw new Error("Ação inválida.");
  }
  await client.query("COMMIT");
} catch(error) {
  console.error(error instanceof Error && !error.message.includes("://") ? error.message : "Falha na auditoria local."); process.exitCode=1;
} finally { await client.end(); }
