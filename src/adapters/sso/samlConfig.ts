// Stored shape for a tenant's SAML SSO configuration — same pattern as StoredSmtpConfig
// (adapters/notify/registry.ts): a JSON blob under a settings key, read/written via SettingsRepo,
// no dedicated table. No secret material here worth encrypting at rest (an IdP certificate is
// public by design — it's how the IdP proves ITS identity to us, not a credential we're protecting).
export const SAML_SETTINGS_KEY = "sso.saml";

export interface StoredSamlConfig {
  enabled: boolean;
  /** The IdP's SSO redirect endpoint (from the IdP's own metadata — "SSO URL", "Sign-on URL", etc). */
  entryPoint: string;
  /** The IdP's own entityID/issuer, used to verify assertions actually came from the expected IdP. */
  idpIssuer: string;
  /** The IdP's PEM-encoded signing certificate, used to verify assertion signatures. */
  idpCert: string;
}
