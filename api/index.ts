import { app } from "../packages/server/dist/app.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const protocol = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers.host ?? "localhost";
  const requestUrl = new URL(req.url ?? "/", `${protocol}://${host}`);
  const requestHeaders = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      requestHeaders.set(name, Array.isArray(value) ? value.join(",") : value);
    }
  }

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : typeof req.body === "string"
        ? req.body
        : req.body === undefined
          ? undefined
          : JSON.stringify(req.body);
  const response = await app.fetch(
    new Request(requestUrl.toString(), {
      method: req.method,
      headers: requestHeaders,
      body,
    }),
  );

  res.statusCode = response.status;
  response.headers.forEach((value: string, name: string) =>
    res.setHeader(name, value),
  );

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    res.write(Buffer.from(chunk.value));
  }
  res.end();
}
