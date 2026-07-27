import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { generateApiKey } from "@api/middleware/apiKey";
import { validateJson, getValidated } from "@api/middleware/validate";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const CreateApiKeySchema = z.object({ name: z.string().min(1).max(100) });

/** Admin-only management of the read-only external API keys (§6 of the improvement plan). The
 * keys themselves are consumed by `requireAuthOrApiKey` on a hand-picked set of GET routes — this
 * file only covers create/list/revoke, never grants write access. */
export function apiKeyRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/admin/api-keys", requireAuth(app), requireRole("admin"), async (c) => {
    const keys = await app.repos.apiKey.list(tenantOf(c));
    return c.json(keys.map((k) => ({ id: k.id, name: k.name, keyPrefix: k.keyPrefix, createdAt: k.createdAt, revokedAt: k.revokedAt, lastUsedAt: k.lastUsedAt })));
  });

  router.post("/admin/api-keys", requireAuth(app), requireRole("admin"), validateJson(CreateApiKeySchema), async (c) => {
    const tenantId = tenantOf(c);
    const user = c.get("user");
    const { name } = getValidated<typeof CreateApiKeySchema>(c);
    const { prefix, token, hash } = generateApiKey();
    const now = app.clock.nowIso();

    const key = await app.repos.apiKey.create({
      id: randomUUID(),
      tenantId,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      scopes: ["read"],
      createdBy: user.id,
      createdAt: now,
      revokedAt: null,
      lastUsedAt: null,
    });

    await app.repos.audit.record({
      tenantId,
      userId: user.id,
      action: "apikey.create",
      entityType: "api_key",
      entityId: key.id,
      detail: { name },
      createdAt: now,
    });

    // The full token is returned exactly once, here, at creation time — it's never recoverable
    // from the DB afterward (only the hash is stored), same trade-off as a GitHub PAT.
    return c.json({ id: key.id, name: key.name, token }, 201);
  });

  router.delete("/admin/api-keys/:id", requireAuth(app), requireRole("admin"), async (c) => {
    const tenantId = tenantOf(c);
    const user = c.get("user");
    const ok = await app.repos.apiKey.revoke(tenantId, c.req.param("id")!);
    if (!ok) return c.json({ error: "NOT_FOUND" }, 404);
    await app.repos.audit.record({
      tenantId,
      userId: user.id,
      action: "apikey.revoke",
      entityType: "api_key",
      entityId: c.req.param("id")!,
      detail: null,
      createdAt: app.clock.nowIso(),
    });
    return c.json({ ok: true });
  });

  return router;
}
