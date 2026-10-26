CREATE TYPE "FormaPagamento" AS ENUM ('PIX', 'DINHEIRO', 'CARTAO');
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO', 'CANCELADO');

-- Sem inferir forma de pagamento para pedidos anteriores à implantação.
ALTER TABLE "Pedido"
  ADD COLUMN "formaPagamento" "FormaPagamento",
  ADD COLUMN "statusPagamento" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN "precisaTroco" BOOLEAN,
  ADD COLUMN "trocoParaCentavos" INTEGER;

ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_pagamento_check" CHECK ((
  ("formaPagamento" IS NULL AND "precisaTroco" IS NULL AND "trocoParaCentavos" IS NULL)
  OR ("formaPagamento" IN ('PIX', 'CARTAO') AND "precisaTroco" IS NULL AND "trocoParaCentavos" IS NULL)
  OR ("formaPagamento" = 'DINHEIRO' AND "precisaTroco" IS NOT NULL AND (
    ("precisaTroco" = false AND "trocoParaCentavos" IS NULL)
    OR ("precisaTroco" = true AND "trocoParaCentavos" IS NOT NULL
      AND "trocoParaCentavos" > 0 AND "trocoParaCentavos" >= "totalCentavos")
  ))
) IS TRUE);
