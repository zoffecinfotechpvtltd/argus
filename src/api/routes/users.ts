import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import { rateLimit } from "@api/middleware/rateLimit";
import { hashPassword, verifyPassword } from "@adapters/crypto";
import { inviteUser, DuplicateUserError, setUserRole, setUserDisabled, changePassword, revokeSession } from "@application/users";
import { getLanUrl } from "@adapters/notify/systemEmail";
import type { AppEnv } from "@api/honoTypes";

const RoleEnum = z.enum(["admin", "operator", "viewer"]);

const InviteUserSchema = z.object({
  email: z.string().email(),
  role: RoleEnum,
  temporaryPassword: z.string().min(10),
  sendEmail: z.boolean().optional(),
});

const SetRoleSchema = z.object({ role: RoleEnum });
const SetDisabledSchema = z.object({ disabled: z.boolean() });

const ChangePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(10),
});

export function userRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/users", requireAuth(app), requireRole("admin"), async (c) => {
    const users = await app.repos.user.list(tenantOf(c));
    return c.json(users.map((u) => ({ id: u.id, email: u.email, role: u.role, disabled: u.disabled, forcePasswordReset: u.forcePasswordReset })));
  });

  router.post("/users", requireAuth(app), requireRole("admin"), validateJson(InviteUserSchema), async (c) => {
    const actor = c.get("user");
    const body = getValidated<typeof InviteUserSchema>(c);
    let user: Awaited<ReturnType<typeof inviteUser>>;
    try {
      user = await inviteUser(app, tenantOf(c), actor.id, {
        email: body.email,
        role: body.role,
        passwordHash: await hashPassword(body.temporaryPassword),
      });
    } catch (err) {
      if (err instanceof DuplicateUserError) return c.json({ error: "DUPLICATE_EMAIL" }, 409);
      throw err;
    }

    if (!body.sendEmail) return c.json({ id: user.id, email: user.email, role: user.role }, 201);

    const loginUrl = getLanUrl(app.config.port);
    const result = await app.systemEmail.send(tenantOf(c), {
      to: user.email,
      subject: `You've been invited to Argus (${app.config.instanceName})`,
      text: `You've been added to Argus as a ${body.role}.\n\nSign in: ${loginUrl}\nEmail: ${user.email}\nTemporary password: ${body.temporaryPassword}\n\nYou'll be asked to set a new password on first sign-in.`,
      html: inviteEmailHtml({ instanceName: app.config.instanceName, loginUrl, email: user.email, role: body.role, temporaryPassword: body.temporaryPassword }),
    });

    return c.json({ id: user.id, email: user.email, role: user.role, emailed: result.ok, emailError: result.ok ? undefined : result.error }, 201);
  });

  router.patch("/users/:id/role", requireAuth(app), requireRole("admin"), validateJson(SetRoleSchema), async (c) => {
    const actor = c.get("user");
    const { role } = getValidated<typeof SetRoleSchema>(c);
    const updated = await setUserRole(app, tenantOf(c), actor.id, c.req.param("id")!, role);
    if (!updated) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ id: updated.id, role: updated.role });
  });

  router.patch("/users/:id/disabled", requireAuth(app), requireRole("admin"), validateJson(SetDisabledSchema), async (c) => {
    const actor = c.get("user");
    const { disabled } = getValidated<typeof SetDisabledSchema>(c);
    if (c.req.param("id") === actor.id && disabled) return c.json({ error: "CANNOT_DISABLE_SELF" }, 400);
    const updated = await setUserDisabled(app, tenantOf(c), actor.id, c.req.param("id")!, disabled);
    if (!updated) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ id: updated.id, disabled: updated.disabled });
  });

  router.post(
    "/users/:id/password",
    requireAuth(app),
    requireRole("viewer"),
    rateLimit({ max: 10, windowMs: 60_000, keyPrefix: "password-change" }),
    validateJson(ChangePasswordSchema),
    async (c) => {
      const actor = c.get("user");
      const targetId = c.req.param("id")!;
      const isSelf = targetId === actor.id;

      if (!isSelf && actor.role !== "admin") return c.json({ error: "FORBIDDEN" }, 403);

      const { currentPassword, newPassword } = getValidated<typeof ChangePasswordSchema>(c);
      if (isSelf) {
        if (!currentPassword || !(await verifyPassword(currentPassword, actor.passwordHash))) {
          return c.json({ error: "INVALID_CURRENT_PASSWORD" }, 401);
        }
      }

      const updated = await changePassword(app, tenantOf(c), actor.id, targetId, await hashPassword(newPassword), isSelf);
      if (!updated) return c.json({ error: "NOT_FOUND" }, 404);
      return c.json({ ok: true });
    }
  );

  router.get("/users/:id/sessions", requireAuth(app), requireRole("viewer"), async (c) => {
    const actor = c.get("user");
    const targetId = c.req.param("id")!;
    if (targetId !== actor.id && actor.role !== "admin") return c.json({ error: "FORBIDDEN" }, 403);
    const sessions = await app.repos.session.listByUser(tenantOf(c), targetId);
    return c.json(sessions.map((s) => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt, ip: s.ip })));
  });

  router.delete("/sessions/:id", requireAuth(app), requireRole("viewer"), async (c) => {
    const actor = c.get("user");
    const session = await app.repos.session.findById(c.req.param("id")!);
    if (!session) return c.json({ error: "NOT_FOUND" }, 404);
    if (session.userId !== actor.id && actor.role !== "admin") return c.json({ error: "FORBIDDEN" }, 403);
    await revokeSession(app, tenantOf(c), actor.id, session.id);
    return c.json({ ok: true });
  });

  return router;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function inviteEmailHtml(opts: { instanceName: string; loginUrl: string; email: string; role: string; temporaryPassword: string }): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:8px;">
    <h2 style="margin:0 0 4px;">You've been added to ${escapeHtml(opts.instanceName)}</h2>
    <p style="color:#475569;margin:0 0 16px;">Role: <strong>${escapeHtml(opts.role)}</strong></p>
    <table style="width:100%;font-size:14px;color:#334155;border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="padding:4px 0;color:#94a3b8;">Email</td><td>${escapeHtml(opts.email)}</td></tr>
      <tr><td style="padding:4px 0;color:#94a3b8;">Temporary password</td><td><code>${escapeHtml(opts.temporaryPassword)}</code></td></tr>
    </table>
    <a href="${opts.loginUrl}" style="display:inline-block;background:#0284c7;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Sign in to ${escapeHtml(opts.instanceName)}</a>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px;">You'll be asked to set a new password on first sign-in. This link only works while the machine running Argus is on and reachable on your network.</p>
  </div>`;
}
