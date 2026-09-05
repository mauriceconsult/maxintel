import { handle } from "hono/vercel";
import { app } from "../packages/server/src/app.js";
export const config = {
  runtime: "nodejs",
};
export default handle(app);
