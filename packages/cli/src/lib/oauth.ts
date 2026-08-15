import open from "open";
import { saveAuth } from "./auth";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

type OAuthState = {
  nonce: string;
  port: number;
};

type TokenResponse = {
  access_token: string;
};

function toBase64Url(input: Uint8Array | string): string {
  return Buffer.from(input).toString("base64url");
}

async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );

  return toBase64Url(new Uint8Array(digest));
}

function encodeState(state: OAuthState): string {
  return toBase64Url(JSON.stringify(state));
}

function decodeState(state: string): OAuthState {
  try {
    return JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    ) as OAuthState;
  } catch {
    throw new Error("Invalid OAuth state");
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function performLogin(): Promise<{ token: string }> {
  const clerkFrontendApi = process.env.CLERK_FRONTEND_API;
  const clientId = process.env.CLERK_OAUTH_CLIENT_ID;

  if (!clerkFrontendApi) {
    throw new Error("CLERK_FRONTEND_API not set");
  }

  if (!clientId) {
    throw new Error("CLERK_OAUTH_CLIENT_ID not set");
  }

  const nonce = crypto.randomUUID();

  const codeVerifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

  const codeChallenge = await createPkceChallenge(codeVerifier);

  let settled = false;
  let server: ReturnType<typeof Bun.serve>;

  return new Promise<{ token: string }>((resolve, reject) => {
    const finish = (callback: () => void) => {
      if (settled) return;

      settled = true;
      callback();

      setTimeout(() => {
        server.stop();
      }, 500);
    };

    server = Bun.serve({
      port: 0,

      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const error = url.searchParams.get("error");

        if (error) {
          const message = url.searchParams.get("error_description") ?? error;

          finish(() => reject(new Error(message)));

          return new Response(`Authentication failed: ${message}`, {
            status: 400,
          });
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code || !state) {
          finish(() =>
            reject(new Error("Missing authorization code or state")),
          );

          return new Response("Bad request", { status: 400 });
        }

        try {
          const payload = decodeState(state);

          if (payload.nonce !== nonce || payload.port !== server.port) {
            throw new Error("OAuth state mismatch");
          }
        } catch (error) {
          finish(() => reject(error));

          return new Response("Invalid state", { status: 400 });
        }

        try {
          // const redirectUri = `http://localhost:${server.port}/callback`;
          const redirectUri = `http://127.0.0.1:${port}/callback`;

          const tokenRes = await fetch(`${clerkFrontendApi}/oauth/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
              client_id: clientId,
              code_verifier: codeVerifier,
            }),
          });

          if (!tokenRes.ok) {
            const details = await tokenRes.text();

            throw new Error(details || "Failed to exchange authorization code");
          }

          const tokenData = (await tokenRes.json()) as TokenResponse;

          if (!tokenData.access_token) {
            throw new Error(
              "OAuth token response did not contain access_token",
            );
          }

          saveAuth({
            token: tokenData.access_token,
          });

          finish(() =>
            resolve({
              token: tokenData.access_token,
            }),
          );

          return new Response("Authenticated! You can close this tab.");
        } catch (error) {
          const message = getErrorMessage(error);

          finish(() => reject(error));

          return new Response(`Authentication failed: ${message}`, {
            status: 400,
          });
        }
      },
    });

    const port = server.port;

    if (typeof port !== "number") {
      server.stop();
      reject(new Error("Failed to start callback server"));
      return;
    }

    const state = encodeState({
      nonce,
      port,
    });

    // const redirectUri = `http://localhost:${port}/callback`;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authorizeUrl = new URL(`${clerkFrontendApi}/oauth/authorize`);

    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", "openid email profile");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "login");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    void open(authorizeUrl.toString());

    setTimeout(() => {
      if (settled) return;

      settled = true;
      server.stop();
      reject(new Error("Login timed out"));
    }, LOGIN_TIMEOUT_MS);
  });
}
