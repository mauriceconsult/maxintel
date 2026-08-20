import { createClerkClient } from "@clerk/backend";

// process.env → Bun.env (consistent with the rest of the server)
if (!Bun.env.CLERK_SECRET_KEY) {
  throw new Error("CLERK_SECRET_KEY env variable is required");
}
if (!Bun.env.CLERK_PUBLISHABLE_KEY) {
  throw new Error("CLERK_PUBLISHABLE_KEY env var is required");
}

const clerkClient = createClerkClient({
  secretKey:       Bun.env.CLERK_SECRET_KEY,
  publishableKey:  Bun.env.CLERK_PUBLISHABLE_KEY,
});
export async function authenticateOAuthRequest(request: Request) {
  const requestState = await clerkClient.authenticateRequest(request, {
    acceptsToken: "oauth_token",
  });
  if (!requestState.isAuthenticated) {
    return null;
  }
  const auth = requestState.toAuth();
  if (auth.tokenType !== "oauth_token" || !auth.userId) {
    return null;
  }
  return { userId: auth.userId };
}
