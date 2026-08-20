ALTER TABLE "ProviderConnection"
    ADD COLUMN IF NOT EXISTS "lastKnownQuotaLimit" INTEGER,
    ADD COLUMN IF NOT EXISTS "lastKnownQuotaWindowSeconds" INTEGER,
    ADD COLUMN IF NOT EXISTS "lastKnownQuotaResetAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "lastKnownQuotaMetric" TEXT;
