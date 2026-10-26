CREATE TABLE "TentativaPagamento" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pedidoId" UUID NOT NULL,
  "chaveCliente" UUID NOT NULL,
  "chaveProvedor" UUID NOT NULL,
  "requisicaoHash" CHAR(64) NOT NULL,
  "orderId" VARCHAR(64),
  "statusExterno" VARCHAR(80),
  "detalheExterno" VARCHAR(100),
  "encerrada" BOOLEAN NOT NULL DEFAULT false,
  "envios" INTEGER NOT NULL DEFAULT 0,
  "bloqueadaAte" TIMESTAMP(3),
  "codigoErro" VARCHAR(80),
  "qrCode" TEXT,
  "qrCodeBase64" TEXT,
  "ticketUrl" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TentativaPagamento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TentativaPagamento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TentativaPagamento_chaveProvedor_key" ON "TentativaPagamento"("chaveProvedor");
CREATE UNIQUE INDEX "TentativaPagamento_orderId_key" ON "TentativaPagamento"("orderId");
CREATE UNIQUE INDEX "TentativaPagamento_pedidoId_chaveCliente_key" ON "TentativaPagamento"("pedidoId", "chaveCliente");
CREATE INDEX "TentativaPagamento_pedidoId_criadoEm_idx" ON "TentativaPagamento"("pedidoId", "criadoEm");
-- Uma tentativa incerta ou pendente bloqueia nova cobrança do mesmo pedido.
CREATE UNIQUE INDEX "TentativaPagamento_ativa_key" ON "TentativaPagamento"("pedidoId") WHERE "encerrada" = false;
