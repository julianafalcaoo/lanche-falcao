CREATE TYPE "EstadoDesafioOtp" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONSUMIDO', 'INVALIDADO');

CREATE TABLE "DesafioOtp" (
    "id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "telefone" TEXT NOT NULL,
    "pinId" TEXT NOT NULL,
    "estado" "EstadoDesafioOtp" NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "consumidoEm" TIMESTAMP(3),
    CONSTRAINT "DesafioOtp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DesafioOtp_pinId_key" ON "DesafioOtp"("pinId");
CREATE INDEX "DesafioOtp_expiraEm_idx" ON "DesafioOtp"("expiraEm");

CREATE TABLE "Sessao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tokenHash" CHAR(64) NOT NULL,
    "clienteId" UUID NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Sessao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sessao_tokenHash_key" ON "Sessao"("tokenHash");
CREATE INDEX "Sessao_clienteId_idx" ON "Sessao"("clienteId");
CREATE INDEX "Sessao_expiraEm_idx" ON "Sessao"("expiraEm");
ALTER TABLE "Sessao" ADD CONSTRAINT "Sessao_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
