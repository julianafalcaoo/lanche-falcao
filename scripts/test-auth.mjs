import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { prisma } from "../src/lib/prisma.ts";

const suite = process.argv[2] ?? "auth";
if (!["auth", "pedidos"].includes(suite)) throw new Error("Suíte de banco não permitida.");
const database = `lf_auth_test_${randomBytes(12).toString("hex")}`;
let created = false;
try {
  const url = new URL(process.env.DATABASE_URL);
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  created = true;
  url.pathname = `/${database}`;
  const env = { ...process.env, DATABASE_URL: url.toString(), AUTH_TEST_DATABASE: database };
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, encoding: "utf8" });
  if (migration.status !== 0) throw new Error("Não foi possível migrar o banco descartável.");
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--test", `tests/${suite}.test.mjs`], { env, stdio: "inherit" });
  if (result.status !== 0) process.exitCode = 1;
} catch {
  console.error("Falha nos testes ou na preparação do banco descartável. Nenhum SMS foi solicitado por este runner.");
  process.exitCode = 1;
} finally {
  try {
    if (created) {
      await prisma.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
      console.log("Banco descartável removido; banco da aplicação preservado.");
    }
  } catch {
    console.error(`Não foi possível remover o banco descartável ${database}.`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}
