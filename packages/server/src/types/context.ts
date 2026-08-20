// packages/server/src/types/context.ts

import type { ApiClient } from "@maxintel/database";

// Extends Hono's context so c.get("client") is fully typed
// in every route handler on the platform router
export type PlatformVariables = {
  Variables: {
    client: Pick<
      ApiClient,
      "id" | "name" | "creditBalance" | "isActive" | "monthlySpendCap"
    >;
  };
};