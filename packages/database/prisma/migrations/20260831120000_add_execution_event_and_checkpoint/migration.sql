-- CreateTable
CREATE TABLE "ExecutionEvent" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,

    CONSTRAINT "ExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionCheckpoint" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "seq" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "ExecutionCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionEvent_executionId_timestamp_idx" ON "ExecutionEvent"("executionId", "timestamp");

-- CreateIndex
CREATE INDEX "ExecutionEvent_executionId_type_idx" ON "ExecutionEvent"("executionId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionEvent_executionId_seq_key" ON "ExecutionEvent"("executionId", "seq");

-- CreateIndex
CREATE INDEX "ExecutionCheckpoint_executionId_timestamp_idx" ON "ExecutionCheckpoint"("executionId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionCheckpoint_executionId_seq_key" ON "ExecutionCheckpoint"("executionId", "seq");