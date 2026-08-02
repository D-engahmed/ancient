import { createMiddleware } from "hono/factory";
import type { AuthenticatedEnv } from "./require-auth";

type RateLimitBucket = {
  startedAt: number;
  requestCount: number;
};

const buckets = new Map<string, RateLimitBucket>();
const windowMs = 60_000;

function getLimit(): number {
  const configured = Number.parseInt(process.env.ANCIENT_BYOK_REQUESTS_PER_MINUTE ?? "60", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 60;
}

export const byokRateLimit = createMiddleware<AuthenticatedEnv>(async (c, next) => {
  const userId = c.get("userId");
  const now = Date.now();
  const limit = getLimit();
  const existing = buckets.get(userId);
  const bucket = !existing || now - existing.startedAt >= windowMs
    ? { startedAt: now, requestCount: 0 }
    : existing;

  bucket.requestCount += 1;
  buckets.set(userId, bucket);

  if (bucket.requestCount > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1_000));
    c.header("Retry-After", String(retryAfterSeconds));
    return c.json({ error: "Too many AI requests. Please try again shortly." }, 429);
  }

  await next();
});
