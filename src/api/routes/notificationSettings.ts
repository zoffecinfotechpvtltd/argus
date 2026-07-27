import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import { SMTP_SETTINGS_KEY, WEBHOOK_SETTINGS_KEY, type StoredSmtpConfig } from "@adapters/notify/registry";
import { encryptSecret } from "@adapters/crypto";
import type { AppEnv } from "@api/honoTypes";
import type { WebhookConfig } from "@adapters/notify/webhookNotifier";
import { SYSLOG_SETTINGS_KEY, buildCefMessage, sendSyslog, type SyslogConfig } from "@adapters/notify/syslogForwarder";

const SmtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().optional(),
  pass: z.string().optional(),
  from: z.string().email(),
});

const WebhookConfigSchema = z.object({ secret: z.string().min(1).optional() });

const TestEmailSchema = z.object({ to: z.string().email() });
const TestWebhookSchema = z.object({ url: z.string().url() });

const SyslogConfigSchema = z.object({
  enabled: z.boolean(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  facility: z.number().int().min(0).max(23),
});

const NotificationPrefsSchema = z.object({
  channels: z.array(z.enum(["email", "webhook"])),
  severityFloor: z.enum(["info", "warning", "critical"]),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
  webhookUrl: z.string().nullable().optional(),
  /** Opt-in personal SLA/alerts summary email, independent of the real-time channels above. */
  digestRecurrence: z.enum(["daily", "weekly"]).nullable().optional(),
});

function redactSmtp(config: StoredSmtpConfig | null): (Omit<StoredSmtpConfig, "passEnc"> & { hasPassword: boolean }) | null {
  if (!config) return null;
  const { passEnc, ...rest } = config;
  return { ...rest, hasPassword: !!passEnc };
}

export function notificationSettingsRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/settings/notifications", requireAuth(app), requireRole("admin"), async (c) => {
    const tenantId = tenantOf(c);
    const smtpRaw = await app.repos.settings.get(tenantId, SMTP_SETTINGS_KEY);
    const webhookRaw = await app.repos.settings.get(tenantId, WEBHOOK_SETTINGS_KEY);

    const syslogRaw = await app.repos.settings.get(tenantId, SYSLOG_SETTINGS_KEY);

    return c.json({
      smtp: redactSmtp(smtpRaw ? (JSON.parse(smtpRaw) as StoredSmtpConfig) : null),
      webhook: webhookRaw ? { hasSecret: !!(JSON.parse(webhookRaw) as WebhookConfig).secret } : { hasSecret: false },
      syslog: syslogRaw ? (JSON.parse(syslogRaw) as SyslogConfig) : { enabled: false, host: "", port: 514, facility: 16 },
    });
  });

  router.put("/settings/notifications/syslog", requireAuth(app), requireRole("admin"), validateJson(SyslogConfigSchema), async (c) => {
    const body = getValidated<typeof SyslogConfigSchema>(c) satisfies SyslogConfig;
    await app.repos.settings.set(tenantOf(c), SYSLOG_SETTINGS_KEY, JSON.stringify(body));
    return c.json({ ok: true });
  });

  const TestSyslogSchema = z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535), facility: z.number().int().min(0).max(23) });

  router.post("/settings/notifications/syslog/test", requireAuth(app), requireRole("admin"), validateJson(TestSyslogSchema), async (c) => {
    const body = getValidated<typeof TestSyslogSchema>(c);
    try {
      await sendSyslog(
        { enabled: true, ...body },
        buildCefMessage({ title: "Argus test message", severity: "info", deviceId: "test", conditionKey: "test" }, "test-device")
      );
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  router.put("/settings/notifications/smtp", requireAuth(app), requireRole("admin"), validateJson(SmtpConfigSchema), async (c) => {
    const tenantId = tenantOf(c);
    const { pass, ...rest } = getValidated<typeof SmtpConfigSchema>(c);
    // An empty password means "keep the existing one" — the UI never re-displays a saved
    // password, so submitting the form without retyping it must not wipe it out.
    let passEnc: string | undefined;
    if (pass) {
      passEnc = encryptSecret(app.instanceKey, pass);
    } else {
      const existingRaw = await app.repos.settings.get(tenantId, SMTP_SETTINGS_KEY);
      passEnc = existingRaw ? (JSON.parse(existingRaw) as StoredSmtpConfig).passEnc : undefined;
    }
    const stored: StoredSmtpConfig = { ...rest, passEnc };
    await app.repos.settings.set(tenantId, SMTP_SETTINGS_KEY, JSON.stringify(stored));
    return c.json({ ok: true });
  });

  router.post("/settings/notifications/smtp/test", requireAuth(app), requireRole("admin"), validateJson(TestEmailSchema), async (c) => {
    const { to } = getValidated<typeof TestEmailSchema>(c);
    const result = await app.notifiers.get("email").sendTest(tenantOf(c), to);
    return c.json(result, result.ok ? 200 : 502);
  });

  router.put("/settings/notifications/webhook", requireAuth(app), requireRole("admin"), validateJson(WebhookConfigSchema), async (c) => {
    const body = getValidated<typeof WebhookConfigSchema>(c) satisfies WebhookConfig;
    await app.repos.settings.set(tenantOf(c), WEBHOOK_SETTINGS_KEY, JSON.stringify(body));
    return c.json({ ok: true });
  });

  router.post(
    "/settings/notifications/webhook/test",
    requireAuth(app),
    requireRole("admin"),
    validateJson(TestWebhookSchema),
    async (c) => {
      const { url } = getValidated<typeof TestWebhookSchema>(c);
      const result = await app.notifiers.get("webhook").sendTest(tenantOf(c), url);
      return c.json(result, result.ok ? 200 : 502);
    }
  );

  router.get("/notification-prefs", requireAuth(app), requireRole("viewer"), async (c) => {
    const user = c.get("user");
    const prefs = await app.repos.notificationPrefs.get(tenantOf(c), user.id);
    return c.json(
      prefs ?? {
        userId: user.id,
        tenantId: tenantOf(c),
        channels: ["email"],
        severityFloor: "warning",
        quietHoursStart: null,
        quietHoursEnd: null,
        webhookUrl: null,
        digestRecurrence: null,
      }
    );
  });

  router.put("/notification-prefs", requireAuth(app), requireRole("viewer"), validateJson(NotificationPrefsSchema), async (c) => {
    const user = c.get("user");
    const body = getValidated<typeof NotificationPrefsSchema>(c);
    await app.repos.notificationPrefs.upsert({
      userId: user.id,
      tenantId: tenantOf(c),
      channels: body.channels,
      severityFloor: body.severityFloor,
      quietHoursStart: body.quietHoursStart ?? null,
      quietHoursEnd: body.quietHoursEnd ?? null,
      webhookUrl: body.webhookUrl ?? null,
      digestRecurrence: body.digestRecurrence ?? null,
    });
    return c.json({ ok: true });
  });

  return router;
}
