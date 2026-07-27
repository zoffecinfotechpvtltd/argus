import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Fingerprint, Link2 } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { CopyField } from "../components/CopyField";
import { useTenantId } from "../hooks/useTenantId";
import { Button, Card, CardBody, CardHeader, FieldGroup, Input, Skeleton, Textarea, useToast } from "../components/ui";
import { useDirty } from "../hooks/useDirty";

interface SamlConfig {
  enabled: boolean;
  entryPoint: string;
  idpIssuer: string;
  idpCert: string;
}

const EMPTY_CONFIG: SamlConfig = { enabled: false, entryPoint: "", idpIssuer: "", idpCert: "" };

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * SSO/SAML admin config (M7) — backend at GET/PUT /api/settings/sso/saml (src/api/routes/sso.ts).
 * The two values an admin actually needs to hand their IdP are the ACS URL and metadata URL,
 * built client-side from this tenant's id (there's no dedicated "who am I" tenant endpoint — see
 * useTenantId's own doc comment) — surfaced up top since that's the reason most admins land here.
 */
export function SettingsSso() {
  const [config, setConfig] = useState<SamlConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const tenantId = useTenantId();
  const toast = useToast();
  const [dirty, markClean] = useDirty(config);

  useEffect(() => {
    api
      .get<SamlConfig | null>("/settings/sso/saml")
      .then((c) => setConfig(c ?? EMPTY_CONFIG))
      .catch(() => setConfig(EMPTY_CONFIG))
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      await api.put("/settings/sso/saml", config);
      markClean();
      toast.success(config.enabled ? "SSO enabled and saved." : "SSO settings saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save SSO settings.");
    } finally {
      setSaving(false);
    }
  }

  const origin = window.location.origin;
  const acsUrl = tenantId ? `${origin}/api/sso/saml/${tenantId}/acs` : null;
  const metadataUrl = tenantId ? `${origin}/api/sso/saml/${tenantId}/metadata` : null;
  const loginUrl = tenantId ? `${origin}/api/sso/saml/${tenantId}/login` : null;

  const canSave = !!config && isValidUrl(config.entryPoint) && config.idpIssuer.trim().length > 0 && config.idpCert.trim().length > 0;

  if (!loaded || !config) {
    return (
      <Layout title="SSO / SAML" subtitle="Sign in through your identity provider">
        <div className="mx-auto max-w-2xl space-y-6">
          <Skeleton className="h-40 w-full" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="SSO / SAML" subtitle="Sign in through your identity provider">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-2xl space-y-6"
      >
        <Card>
          <CardBody>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Link2 size={16} className="text-accent" aria-hidden="true" />
                  Your tenant's SAML endpoints
                </span>
              }
              description="Paste these into your identity provider's application configuration — most IdPs call them the ACS URL / reply URL and the SP entity ID / metadata URL."
            />
            <div className="space-y-3">
              <CopyField label="ACS URL (assertion consumer service)" value={acsUrl ?? "Loading…"} hint="Where your IdP sends the signed assertion after a user signs in." />
              <CopyField label="SP metadata URL" value={metadataUrl ?? "Loading…"} openable={!!metadataUrl} hint="Public — most IdPs can import your SP config directly from this URL." />
              <CopyField label="Login URL" value={loginUrl ?? "Loading…"} openable={!!loginUrl} hint="Where a 'Sign in with SSO' link on your side should point once SSO is enabled below." />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Fingerprint size={16} className="text-accent" aria-hidden="true" />
                  Identity provider configuration
                </span>
              }
              description="One IdP per tenant. Get these three values from your IdP's application setup screen (Okta, Azure AD / Entra ID, Google Workspace, or any SAML 2.0 provider)."
            />
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="cursor-pointer accent-accent"
                />
                Enable SSO sign-in for this tenant
              </label>

              <FieldGroup label="IdP entry point (single sign-on URL)" hint="Where Argus redirects a user to authenticate — sometimes called the SSO URL or login URL on the IdP's side.">
                {(ids) => (
                  <Input
                    {...ids}
                    className="w-full"
                    placeholder="https://your-idp.example.com/sso/saml"
                    value={config.entryPoint}
                    onChange={(e) => setConfig({ ...config, entryPoint: e.target.value })}
                  />
                )}
              </FieldGroup>

              <FieldGroup label="IdP issuer / entity ID" hint="The identity provider's own identifier — found on the same screen as the entry point URL.">
                {(ids) => (
                  <Input
                    {...ids}
                    className="w-full"
                    placeholder="https://your-idp.example.com/saml/metadata"
                    value={config.idpIssuer}
                    onChange={(e) => setConfig({ ...config, idpIssuer: e.target.value })}
                  />
                )}
              </FieldGroup>

              <FieldGroup label="IdP signing certificate" hint="The X.509 certificate your IdP uses to sign assertions — paste the full PEM block, including the BEGIN/END lines.">
                {(ids) => (
                  <Textarea
                    {...ids}
                    className="h-32 w-full font-mono text-xs"
                    placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                    value={config.idpCert}
                    onChange={(e) => setConfig({ ...config, idpCert: e.target.value })}
                  />
                )}
              </FieldGroup>

              <div className="flex items-center gap-3 pt-1">
                {dirty && (
                  <Button onClick={save} disabled={saving || !canSave}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                )}
                {dirty && !canSave && (config.entryPoint || config.idpIssuer || config.idpCert) && (
                  <p className="text-xs text-text-secondary">Fill in a valid entry point URL, issuer, and certificate to save.</p>
                )}
              </div>

              <p className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-warning">
                New sign-ins via SSO auto-create an account (viewer role) the first time an email is seen — an existing account with a matching email signs
                straight into it. Test with a non-admin account first after connecting a new IdP.
              </p>
            </div>
          </CardBody>
        </Card>
      </motion.div>
    </Layout>
  );
}
