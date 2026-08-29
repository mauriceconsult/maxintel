import { handle } from "hono/vercel";
// Import directly from the workspace package instead of navigating the dist folder manually
import { app } from "../packages/server/src/app";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
