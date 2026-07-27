import { useAuth } from "../auth/AuthContext";

/** The current tenant's id, for building tenant-scoped URLs (SSO ACS/metadata endpoints, the
 * public status page link). Null only while the auth context is still loading. */
export function useTenantId(): string | null {
  const { user } = useAuth();
  return user?.tenantId ?? null;
}
