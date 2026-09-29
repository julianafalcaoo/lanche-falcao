CREATE TYPE "TipoPedido" AS ENUM ('RETIRADA', 'ENTREGA');
CREATE TYPE "StatusPedido" AS ENUM ('PEDIDO_RECEBIDO', 'EM_PREPARACAO', 'PRONTO', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'PRONTO_PARA_RETIRADA', 'RETIRADO');

CREATE TABLE "Pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clienteId" UUID NOT NULL,
    "tipo" "TipoPedido" NOT NULL,
    "status" "StatusPedido" NOT NULL DEFAULT 'PEDIDO_RECEBIDO',
    "subtotalCentavos" INTEGER NOT NULL,
    "totalCentavos" INTEGER NOT NULL,
    "chaveIdempotencia" UUID NOT NULL,
    "requisicaoHash" CHAR(64) NOT NULL,
    "entregaCep" VARCHAR(8),
    "entregaRua" VARCHAR(200),
    "entregaNumero" VARCHAR(200),
    "entregaBairro" VARCHAR(200),
    "entregaCidade" VARCHAR(200),
    "entregaUf" VARCHAR(2),
    "entregaComplemento" VARCHAR(200),
    "entregaReferencia" VARCHAR(200),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Pedido_valores_check" CHECK ("subtotalCentavos" > 0 AND "totalCentavos" = "subtotalCentavos"),
    CONSTRAINT "Pedido_status_tipo_check" CHECK (
      "status" IN ('PEDIDO_RECEBIDO', 'EM_PREPARACAO') OR
      ("tipo" = 'ENTREGA' AND "status" IN ('PRONTO', 'SAIU_PARA_ENTREGA', 'ENTREGUE')) OR
      ("tipo" = 'RETIRADA' AND "status" IN ('PRONTO_PARA_RETIRADA', 'RETIRADO'))
    ),
    CONSTRAINT "Pedido_endereco_check" CHECK (
      ("tipo" = 'RETIRADA' AND "entregaCep" IS NULL AND "entregaRua" IS NULL AND "entregaNumero" IS NULL
        AND "entregaBairro" IS NULL AND "entregaCidade" IS NULL AND "entregaUf" IS NULL
        AND "entregaComplemento" IS NULL AND "entregaReferencia" IS NULL) OR
      ("tipo" = 'ENTREGA' AND "entregaCep" IS NOT NULL AND "entregaCep" ~ '^[0-9]{8}$'
        AND "entregaRua" IS NOT NULL AND length(trim("entregaRua")) > 0
        AND "entregaNumero" IS NOT NULL AND length(trim("entregaNumero")) > 0
        AND "entregaBairro" IS NOT NULL AND length(trim("entregaBairro")) > 0
        AND "entregaCidade" IS NOT NULL AND length(trim("entregaCidade")) > 0
        AND "entregaUf" IS NOT NULL AND "entregaUf" IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'))
    )
);
CREATE UNIQUE INDEX "Pedido_clienteId_chaveIdempotencia_key" ON "Pedido"("clienteId", "chaveIdempotencia");
CREATE INDEX "Pedido_clienteId_criadoEm_id_idx" ON "Pedido"("clienteId", "criadoEm" DESC, "id" DESC);
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ItemPedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedidoId" UUID NOT NULL,
    "produtoId" VARCHAR(100) NOT NULL,
    "nomeProduto" VARCHAR(200) NOT NULL,
    "precoUnitarioCentavos" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "subtotalCentavos" INTEGER NOT NULL,
    CONSTRAINT "ItemPedido_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ItemPedido_quantidade_check" CHECK ("quantidade" BETWEEN 1 AND 100),
    CONSTRAINT "ItemPedido_valores_check" CHECK ("precoUnitarioCentavos" > 0 AND "subtotalCentavos" = "precoUnitarioCentavos"::BIGINT * "quantidade")
);
CREATE UNIQUE INDEX "ItemPedido_pedidoId_produtoId_key" ON "ItemPedido"("pedidoId", "produtoId");
ALTER TABLE "ItemPedido" ADD CONSTRAINT "ItemPedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
