import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Double transacional para testar os serviços sem conectar PostgreSQL ou executar SQL.
// Não substitui a validação futura de migrations/constraints em PostgreSQL isolado.
export function paymentMemory(t, prisma) {
  const mockMethod = (object, method, implementation) => {
    const original = object[method];
    object[method] = t.mock.fn(implementation);
    t.after(() => { object[method] = original; });
  };
  let tables = { pedido: [], tentativaPagamento: [], webhookOrder: [] };
  const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some(part => matches(row, part));
    if (key === "AND") return expected.every(part => matches(row, part));
    if (key === "pedidoId_chaveCliente") return matches(row, expected);
    const actual = row[key];
    if (expected instanceof Date) return actual?.getTime() === expected.getTime();
    if (expected && typeof expected === "object") return Object.entries(expected).every(([op, value]) => {
      if (op === "not") return actual !== value;
      if (op === "lte") return actual != null && actual <= value;
      if (op === "gt") return actual != null && actual > value;
      if (op === "in") return value.includes(actual);
      throw new Error(`Operador inesperado: ${op}`);
    });
    return actual === expected;
  });
  const change = (row, data) => {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
    return structuredClone(row);
  };
  for (const model of Object.keys(tables)) {
    const find = ({ where, orderBy = [], take } = {}) => {
      let rows = tables[model].filter(row => matches(row, where));
      rows = [...rows].sort((a, b) => {
        for (const order of Array.isArray(orderBy) ? orderBy : [orderBy]) {
          const [key, direction] = Object.entries(order)[0];
          const sort = typeof direction === "string" ? direction : direction.sort;
          if (a[key] === b[key] || (a[key] instanceof Date && a[key]?.getTime() === b[key]?.getTime())) continue;
          if (a[key] == null || b[key] == null) return a[key] == null ? -1 : 1;
          return (a[key] < b[key] ? -1 : 1) * (sort === "desc" ? -1 : 1);
        }
        return 0;
      });
      return structuredClone(take === undefined ? rows : rows.slice(0, take));
    };
    const create = ({ data }) => {
      if (model === "tentativaPagamento" && tables[model].some(row => row.pedidoId === data.pedidoId && !row.encerrada)) {
        throw Object.assign(new Error("Tentativa ativa duplicada"), { code: "P2002" });
      }
      const row = {
        id: randomUUID(), criadoEm: new Date(), atualizadoEm: new Date(),
        ...(model === "tentativaPagamento" ? { orderId: null, encerrada: false, envios: 0, bloqueadaAte: null, statusLocal: null, metodoExterno: null, tipoMetodoExterno: null, codigoErro: null, statusExterno: null, detalheExterno: null, qrCode: null, qrCodeBase64: null, ticketUrl: null, reconciliadaEm: null } : {}),
        ...(model === "webhookOrder" ? { processadoEm: null, proximaExecucaoEm: new Date(), reservaToken: null, reservadaAte: null, tentativas: 0, codigoErro: null } : {}), ...structuredClone(data),
      };
      tables[model].push(row);
      return structuredClone(row);
    };
    const methods = {
      findMany: async args => find(args),
      findFirst: async args => find(args)[0] ?? null,
      findUnique: async args => find(args)[0] ?? null,
      findUniqueOrThrow: async args => { const row = find(args)[0]; assert.ok(row, `${model} inexistente`); return row; },
      create: async args => create(args),
      update: async ({ where, data }) => { const row = tables[model].find(row => matches(row, where)); assert.ok(row); return change(row, data); },
      updateMany: async ({ where, data }) => { const rows = tables[model].filter(row => matches(row, where)); rows.forEach(row => change(row, data)); return { count: rows.length }; },
      upsert: async ({ where, create: data, update }) => { const row = tables[model].find(row => matches(row, where)); return row ? change(row, update) : create({ data }); },
    };
    for (const [method, implementation] of Object.entries(methods)) mockMethod(prisma[model], method, implementation);
  }
  let tail = Promise.resolve();
  mockMethod(prisma, "$transaction", async callback => {
    const preceding = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await preceding;
    const snapshot = structuredClone(tables);
    try { return await callback(prisma); }
    catch (error) { tables = snapshot; throw error; }
    finally { release(); }
  });
  mockMethod(prisma, "$queryRaw", async () => []);
  return {
    rows: model => structuredClone(tables[model]),
    insert: (model, row) => tables[model].push(structuredClone(row)),
    remove: (model, id) => { tables[model] = tables[model].filter(row => row.id !== id); },
  };
}
