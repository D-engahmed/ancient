ALTER TABLE "ExecutionEvent" ADD COLUMN "userId" TEXT;
CREATE INDEX "ExecutionEvent_userId_timestamp_idx" ON "ExecutionEvent"("userId", "timestamp");
