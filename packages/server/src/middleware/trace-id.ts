// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

// First-in-chain gateway middleware (docs/02 §A). Generates or forwards a
// traceId for the request and stamps it on EVERY response that flows through
// it — including responses short-circuited by inner middleware (requireAuth,
// byokRateLimit) and onError replies — so an error body's traceId always
// matches the X-Trace-Id header a user pastes into a bug report.
//
// An inbound X-Trace-Id is honoured only when it looks like a safe opaque id;
// anything else is ignored so users can't inject arbitrary headers.

import { createMiddleware } from "hono/factory";

export const TRACE_ID_HEADER = "X-Trace-Id";
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

export const traceId = createMiddleware<{ Variables: { traceId: string } }>(async (c, next) => {
  const incoming = c.req.header(TRACE_ID_HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  c.set("traceId", id);
  await next();
  // Every response carries the traceId it was served under, even ones
  // short-circuited by inner middleware or onError. (c.header(name) with no
  // value is a *setter* in Hono — there is no response-header getter.)
  c.header(TRACE_ID_HEADER, id);
});