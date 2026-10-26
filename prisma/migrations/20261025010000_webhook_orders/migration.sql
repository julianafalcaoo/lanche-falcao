ALTER TYPE "StatusPagamento" ADD VALUE 'ESTORNADO';
ALTER TYPE "StatusPagamento" ADD VALUE 'ESTORNADO_PARCIAL';
ALTER TYPE "StatusPagamento" ADD VALUE 'CONTESTADO';

ALTER TABLE "TentativaPagamento"
  ADD COLUMN "statusLocal" "StatusPagamento",
  ADD COLUMN "metodoExterno" VARCHAR(40),
  ADD COLUMN "tipoMetodoExterno" VARCHAR(40),
  ADD COLUMN "reconciliadaEm" TIMESTAMP(3),
  ADD COLUMN "atualizadaNoProvedor" VARCHAR(40);

-- Preserva o histórico já conhecido sem inventar um método de cartão.
UPDATE "TentativaPagamento" SET "statusLocal" = CASE
  WHEN "statusExterno" = 'processed' AND "detalheExterno" = 'accredited' THEN 'APROVADO'::"StatusPagamento"
  WHEN "statusExterno" = 'failed' AND "detalheExterno" = 'failed' THEN 'RECUSADO'::"StatusPagamento"
  WHEN "statusExterno" IN ('canceled', 'expired') THEN 'CANCELADO'::"StatusPagamento"
  ELSE 'PENDENTE'::"StatusPagamento" END;

CREATE TABLE "WebhookOrder" (
  "id" CHAR(64) NOT NULL PRIMARY KEY,
  "orderId" VARCHAR(64) NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processadoEm" TIMESTAMP(3),
  "proximaExecucaoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reservaToken" UUID,
  "reservadaAte" TIMESTAMP(3),
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "codigoErro" VARCHAR(80)
);
CREATE INDEX "WebhookOrder_processadoEm_proximaExecucaoEm_idx" ON "WebhookOrder"("processadoEm", "proximaExecucaoEm");
