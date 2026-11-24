ALTER TABLE "Pedido"
  ADD COLUMN "taxaEntregaCentavos" INTEGER NOT NULL DEFAULT 0,
  DROP CONSTRAINT "Pedido_valores_check",
  ADD CONSTRAINT "Pedido_valores_check" CHECK (
    "subtotalCentavos" > 0
    AND "taxaEntregaCentavos" >= 0
    AND "totalCentavos" = "subtotalCentavos"::BIGINT + "taxaEntregaCentavos"
    AND ("tipo" = 'ENTREGA' OR "taxaEntregaCentavos" = 0)
  );
