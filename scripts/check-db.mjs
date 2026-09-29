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
  const challengeColumns = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'DesafioOtp'
  `;
  assert.deepEqual(challengeColumns.map((item) => item.column_name).sort(),
    ["id", "nome", "telefone", "pinId", "estado", "criadoEm", "expiraEm", "consumidoEm"].sort());
  const sessionColumns = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Sessao'
  `;
  assert.deepEqual(sessionColumns.map((item) => item.column_name).sort(),
    ["id", "tokenHash", "clienteId", "criadoEm", "expiraEm"].sort());
  const authIndexes = await prisma.$queryRaw`
    SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('Sessao', 'DesafioOtp')
  `;
  assert.ok(authIndexes.some((item) => /UNIQUE.*\("tokenHash"\)/.test(item.indexdef)));
  assert.ok(authIndexes.some((item) => /UNIQUE.*\("pinId"\)/.test(item.indexdef)));
  await prisma.desafioOtp.count();
  await prisma.sessao.count();
  console.log("DesafioOtp e Sessao presentes, sem coluna de OTP/token bruto; índices UNIQUE conferidos.");
  const orderColumns = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('Pedido', 'ItemPedido')
  `;
  const orderColumn = (table, name) => orderColumns.find((item) => item.table_name === table && item.column_name === name);
  for (const table of ["Pedido", "ItemPedido"]) {
    assert.equal(orderColumn(table, "id")?.data_type, "uuid");
    assert.match(orderColumn(table, "id").column_default, /gen_random_uuid/);
    assert.equal(orderColumn(table, "subtotalCentavos")?.data_type, "integer");
  }
  assert.equal(orderColumn("Pedido", "totalCentavos")?.data_type, "integer");
  assert.equal(orderColumn("ItemPedido", "precoUnitarioCentavos")?.data_type, "integer");
  assert.equal(orderColumn("ItemPedido", "quantidade")?.data_type, "integer");
  assert.match(orderColumn("Pedido", "status").column_default, /PEDIDO_RECEBIDO/);
  assert.match(orderColumn("Pedido", "criadoEm").column_default, /CURRENT_TIMESTAMP|now\(/i);
  const enums = await prisma.$queryRaw`
    SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname IN ('TipoPedido', 'StatusPedido') ORDER BY e.enumsortorder
  `;
  assert.deepEqual(enums.filter((item) => item.typname === "TipoPedido").map((item) => item.enumlabel), ["RETIRADA", "ENTREGA"]);
  assert.deepEqual(enums.filter((item) => item.typname === "StatusPedido").map((item) => item.enumlabel),
    ["PEDIDO_RECEBIDO", "EM_PREPARACAO", "PRONTO", "SAIU_PARA_ENTREGA", "ENTREGUE", "PRONTO_PARA_RETIRADA", "RETIRADO"]);
  const constraints = await prisma.$queryRaw`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname IN ('Pedido', 'ItemPedido')
  `;
  for (const name of ["Pedido_valores_check", "Pedido_status_tipo_check", "Pedido_endereco_check", "ItemPedido_quantidade_check", "ItemPedido_valores_check"]) {
    assert.ok(constraints.some((item) => item.conname === name), `Constraint ausente: ${name}`);
  }
  assert.match(constraints.find((item) => item.conname === "Pedido_clienteId_fkey")?.definition ?? "", /REFERENCES "Cliente"\(id\).*ON DELETE RESTRICT/);
  assert.match(constraints.find((item) => item.conname === "ItemPedido_pedidoId_fkey")?.definition ?? "", /REFERENCES "Pedido"\(id\).*ON DELETE CASCADE/);
  const orderIndexes = await prisma.$queryRaw`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('Pedido', 'ItemPedido')
  `;
  assert.ok(orderIndexes.some((item) => item.indexname === "Pedido_clienteId_chaveIdempotencia_key" && item.indexdef.includes("UNIQUE")));
  assert.ok(orderIndexes.some((item) => item.indexname === "ItemPedido_pedidoId_produtoId_key" && item.indexdef.includes("UNIQUE")));
  assert.ok(orderIndexes.some((item) => item.indexname === "Pedido_clienteId_criadoEm_id_idx"));
  console.log(`Pedidos existentes: ${await prisma.pedido.count()}; itens existentes: ${await prisma.itemPedido.count()}.`);
  console.log("Pedido e ItemPedido: tipos monetários, UUIDs, enums, índices, relacionamentos e CHECKs verificados, sem inserir dados.");
} finally {
  await prisma.$disconnect();
}
