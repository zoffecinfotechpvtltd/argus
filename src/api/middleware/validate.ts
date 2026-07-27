import type { Context as HonoContext, Next } from "hono";
import type { ZodTypeAny, z } from "zod";
import type { AppEnv } from "@api/honoTypes";

type Context = HonoContext<AppEnv>;

export function validateJson<S extends ZodTypeAny>(schema: S) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "INVALID_JSON" }, 400);
    }
    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json({ error: "VALIDATION_ERROR", issues: result.error.issues }, 400);
    }
    c.set("validatedBody", result.data);
    await next();
  };
}

export function getValidated<S extends ZodTypeAny>(c: Context): z.infer<S> {
  return c.get("validatedBody") as z.infer<S>;
}

export function validateQuery<S extends ZodTypeAny>(schema: S) {
  return async (c: Context, next: Next) => {
    const query = c.req.query();
    const result = schema.safeParse(query);
    if (!result.success) {
      return c.json({ error: "VALIDATION_ERROR", issues: result.error.issues }, 400);
    }
    c.set("validatedQuery", result.data);
    await next();
  };
}

export function getValidatedQuery<S extends ZodTypeAny>(c: Context): z.infer<S> {
  return c.get("validatedQuery") as z.infer<S>;
}
