DO $$ BEGIN
    CREATE TYPE "Role" AS ENUM ('USER', 'ASSISTANT', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "Mode" AS ENUM ('BUILD', 'PLAN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "MessageStatus" AS ENUM ('COMPLETE', 'INTERRUPTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cwd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "modelKind" TEXT NOT NULL,
    "modelRef" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parts" JSONB,
    "mode" "Mode" NOT NULL,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ModelProvider" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "defaultBaseUrl" TEXT NOT NULL,
    "isReseller" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ModelProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ModelCatalogEntry" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contextWindow" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModelCatalogEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModelCatalogEntry_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "Message_sessionId_idx" ON "Message"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "ModelCatalogEntry_providerId_modelId_key" ON "ModelCatalogEntry"("providerId", "modelId");
