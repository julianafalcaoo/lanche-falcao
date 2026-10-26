CREATE TABLE "LimiteOtp" (
  "chave" CHAR(64) NOT NULL PRIMARY KEY,
  "quantidade" INTEGER NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LimiteOtp_quantidade_check" CHECK ("quantidade" > 0)
);
CREATE INDEX "LimiteOtp_expiraEm_idx" ON "LimiteOtp"("expiraEm");
