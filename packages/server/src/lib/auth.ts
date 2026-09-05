import { createClerkClient } from "@clerk/backend";

// process.env → Bun.env (consistent with the rest of the server)
if (!process.env.CLERK_SECRET_KEY) {
  throw new Error("CLERK_SECRET_KEY env variable is required");
}
const clerkPublishableKey =
  process.env.CLERK_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
if (!clerkPublishableKey) {
  throw new Error("CLERK_PUBLISHABLE_KEY env var is required");
}

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: clerkPublishableKey,
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
