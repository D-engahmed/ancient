CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "ProviderConnection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "encryptedKey" BYTEA NOT NULL,
    "keyLastFour" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProviderConnection_userId_idx" ON "ProviderConnection"("userId");
