BEGIN;

LOCK TABLE "Lead" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Lead") THEN
        RAISE EXCEPTION 'Conversao interrompida: existem Leads. Revise os dados antes de migrar.';
    END IF;
END $$;

DROP INDEX "Lead_email_key";


ALTER TABLE "Lead" DROP COLUMN "email",
DROP COLUMN "emailVerificado",
ADD COLUMN     "endereco" TEXT NOT NULL,
ADD COLUMN     "telefoneVerificado" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Lead_telefone_key" ON "Lead"("telefone");

COMMIT;
