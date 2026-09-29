import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.ts";

try {
  const columns = await prisma.$queryRaw`
    SELECT column_name, column_default, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Cliente'
  `;
  assert.equal(columns.length, 6, "A tabela Cliente deve conter os seis campos previstos.");
  assert.ok(columns.every((column) => column.is_nullable === "NO"));
  const column = (name) => columns.find((item) => item.column_name === name);
  assert.equal(column("id").data_type, "uuid");
  assert.match(column("id").column_default, /gen_random_uuid/);
  assert.match(column("telefoneVerificado").column_default, /false/);
  assert.match(column("criadoEm").column_default, /CURRENT_TIMESTAMP|now\(/i);
  assert.match(column("atualizadoEm").column_default, /CURRENT_TIMESTAMP|now\(/i);
  const indexes = await prisma.$queryRaw`
    SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Cliente'
  `;
  assert.ok(indexes.some((index) => /UNIQUE.*\(telefone\)/.test(index.indexdef)), "Telefone precisa ser único.");
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /atualizadoEm\s+DateTime[^\r\n]*@updatedAt/);
  const count = await prisma.cliente.count();
  console.log("Conexão Prisma OK. Cliente, UNIQUE, defaults e @updatedAt verificados.");
  console.log(`Clientes existentes: ${count}. Nenhum registro foi inserido pelo teste.`);
} finally {
  await prisma.$disconnect();
}
