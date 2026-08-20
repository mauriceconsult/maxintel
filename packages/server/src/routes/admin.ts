// Admin-only routes — PLATFORM_ADMIN_KEY required (separate from client API keys)
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, TransactionType } from "@maxintel/database";
import { addCredits } from "../lib/credits";

function requireAdminKey(c: {
  req: { header: (k: string) => string | undefined };
}) {
  return c.req.header("X-Admin-Key") === Bun.env.PLATFORM_ADMIN_KEY;
}

const createClientSchema = z.object({
  name: z.string().min(1),
  monthlySpendCap: z.number().int().positive().optional(),
  bonusCredits: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
});

const grantSchema = z.object({
  credits: z.number().int().positive(),
  description: z.string().default("Admin bonus grant"),
});

const app = new Hono()

  // ── POST /admin/clients — provision a new API client ───────────────────────
  .post("/clients", zValidator("json", createClientSchema), async (c) => {
    if (!requireAdminKey(c)) return c.json({ error: "Forbidden" }, 403);

    const { name, monthlySpendCap, bonusCredits, notes } = c.req.valid("json");
    const apiKey = `mxi_${crypto.randomUUID().replace(/-/g, "")}`;

    const client = await db.apiClient.create({
      data: {
        name,
        apiKey,
        monthlySpendCap,
        notes,
        creditBalance: bonusCredits,
      },
    });

    if (bonusCredits > 0) {
      await addCredits({
        clientId: client.id,
        type: TransactionType.BONUS,
        credits: bonusCredits,
        description: "Onboarding bonus credits",
      });
    }

    return c.json({ id: client.id, name: client.name, apiKey }, 201);
  })

  // ── GET /admin/clients — list all clients ──────────────────────────────────
  .get("/clients", async (c) => {
    if (!requireAdminKey(c)) return c.json({ error: "Forbidden" }, 403);

    const clients = await db.apiClient.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        creditBalance: true,
        isActive: true,
        monthlySpendCap: true,
        createdAt: true,
      },
    });
    return c.json(clients);
  })

  // ── POST /admin/clients/:id/grant — add credits to a client ────────────────
  .post("/clients/:id/grant", zValidator("json", grantSchema), async (c) => {
    if (!requireAdminKey(c)) return c.json({ error: "Forbidden" }, 403);

    const { id } = c.req.param();
    const { credits, description } = c.req.valid("json");

    const client = await db.apiClient.findUnique({ where: { id } });
    if (!client) return c.json({ error: "Client not found" }, 404);

    const { balanceAfter } = await addCredits({
      clientId: id,
      type: TransactionType.BONUS,
      credits,
      description,
    });

    return c.json({ clientId: id, creditsGranted: credits, balanceAfter });
  })

  // ── PATCH /admin/clients/:id — toggle active, update cap ───────────────────
  .patch("/clients/:id", async (c) => {
    if (!requireAdminKey(c)) return c.json({ error: "Forbidden" }, 403);

    const { id } = c.req.param();
    const body = (await c.req.json()) as {
      isActive?: boolean;
      monthlySpendCap?: number | null;
    };

    const updated = await db.apiClient.update({
      where: { id },
      data: { isActive: body.isActive, monthlySpendCap: body.monthlySpendCap },
    });

    return c.json({
      id: updated.id,
      isActive: updated.isActive,
      monthlySpendCap: updated.monthlySpendCap,
    });
  });

export default app;
