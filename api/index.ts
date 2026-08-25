import { handle } from "@hono/node-server/vercel";
import { app } from "../packages/server/src/app";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
