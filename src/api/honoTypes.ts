import type { RemoteAgent, Session, User } from "@domain/entities";

/** Shared Hono context variable shape so `c.get("user")` etc. are typed everywhere without manual casts. */
export interface AppVariables {
  user: User;
  session: Session;
  tenantId: string;
  validatedBody: unknown;
  validatedQuery: unknown;
  /** Set by requireAgentToken instead of `user` for remote-agent-authenticated requests — an
   * agent isn't a user, there's no session/role to synthesize. */
  agent: RemoteAgent;
}

/** `Bun.serve({ fetch: hono.fetch })` passes the Bun `Server` instance as fetch's second
 * positional argument, which Hono treats as `env` — so `c.env` here actually is that Server, and
 * `c.env.requestIP(c.req.raw)` gives the real TCP peer address. Typed minimally rather than
 * pulling in Bun's full Server type. */
export interface AppBindings {
  requestIP(request: Request): { address: string; port: number; family: string } | null;
}

export type AppEnv = { Variables: AppVariables; Bindings: AppBindings };
