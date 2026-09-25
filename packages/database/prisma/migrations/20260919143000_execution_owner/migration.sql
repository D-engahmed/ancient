ALTER TABLE "ExecutionEvent" ADD COLUMN "userId" TEXT;
CREATE INDEX "ExecutionEvent_userId_timestamp_idx" ON "ExecutionEvent"("userId", "timestamp");

-- Recover ownership for existing events created before the explicit owner column
-- existed. Existing created payloads already carried the authenticated user id.
WITH owners AS (
  SELECT DISTINCT ON ("executionId")
         "executionId",
         payload->>'userId' AS "ownerId"
  FROM "ExecutionEvent"
  WHERE type = 'created'
    AND payload ? 'userId'
    AND jsonb_typeof(payload) = 'object'
  ORDER BY "executionId", "timestamp" ASC
)
UPDATE "ExecutionEvent" AS event
SET "userId" = owners."ownerId"
FROM owners
WHERE event."executionId" = owners."executionId"
  AND event."userId" IS NULL;
