// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { createClerkClient } from "@clerk/backend";

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerkClient() {
  if (clerkClient) return clerkClient;
  if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) {
    throw new Error("CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY are required");
  }
  clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  });
  return clerkClient;
}

export async function authenticateOAuthRequest(request: Request) {
  try {
    const client = getClerkClient();
    const requestState = await client.authenticateRequest(request, {
      acceptsToken: "oauth_token",
    });
    if (!requestState.isAuthenticated) return null;
    const auth = requestState.toAuth();
    if (auth.tokenType !== "oauth_token" || !auth.userId) return null;
    return { userId: auth.userId };
  } catch {
    return null;
  }
}