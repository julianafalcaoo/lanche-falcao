-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "emailVerificado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificacaoOtp" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "utilizadoEm" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificacaoOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_email_key" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "VerificacaoOtp_leadId_createdAt_idx" ON "VerificacaoOtp"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "VerificacaoOtp" ADD CONSTRAINT "VerificacaoOtp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
