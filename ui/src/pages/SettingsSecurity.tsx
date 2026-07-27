import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { Button, Card, CardBody, CardHeader, FieldGroup, Input, useToast } from "../components/ui";
import { useAuth } from "../auth/AuthContext";

export function SettingsSecurity() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [enrolling, setEnrolling] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [disabling, setDisabling] = useState(false);

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingPassword(true);
    try {
      await api.post(`/users/${user.id}/password`, { currentPassword, newPassword });
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === "INVALID_CURRENT_PASSWORD" ? "Current password is incorrect." : "Failed to update password.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function startEnroll() {
    setEnrolling(true);
    try {
      const res = await api.post<{ secret: string; uri: string }>("/auth/totp/enroll");
      setSecret(res.secret);
      setUri(res.uri);
    } catch {
      toast.error("Failed to start 2FA enrollment.");
    } finally {
      setEnrolling(false);
    }
  }

  async function confirmEnroll() {
    setVerifying(true);
    try {
      await api.post("/auth/totp/verify", { code: verifyCode });
      toast.success("Two-factor authentication enabled.");
      setSecret(null);
      setUri(null);
      setVerifyCode("");
      await refresh();
    } catch {
      toast.error("That code didn't verify — check your authenticator app and try again.");
    } finally {
      setVerifying(false);
    }
  }

  async function disable2fa() {
    setDisabling(true);
    try {
      await api.post("/auth/totp/disable");
      toast.success("Two-factor authentication disabled.");
      await refresh();
    } catch {
      toast.error("Failed to disable 2FA.");
    } finally {
      setDisabling(false);
    }
  }

  return (
    <Layout title="Security" subtitle="Password and two-factor authentication for your account">
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardHeader title="Change password" />
          <CardBody>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <FieldGroup label="Current password">
                {(ids) => (
                  <Input {...ids} type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full" />
                )}
              </FieldGroup>
              <FieldGroup label="New password" hint="At least 10 characters.">
                {(ids) => (
                  <Input {...ids} type="password" required minLength={10} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full" />
                )}
              </FieldGroup>
              <Button type="submit" disabled={savingPassword}>{savingPassword ? "Saving…" : "Update password"}</Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Two-factor authentication (2FA)" />
          <CardBody>
            {user?.totpEnabled ? (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm text-text-primary">
                  <ShieldCheck size={16} className="text-accent" aria-hidden="true" /> 2FA is enabled on your account.
                </p>
                <Button variant="secondary" onClick={disable2fa} disabled={disabling}>
                  {disabling ? "Disabling…" : "Disable 2FA"}
                </Button>
              </div>
            ) : secret ? (
              <div className="space-y-4">
                <p className="text-sm text-text-secondary">
                  Scan this into your authenticator app (Google Authenticator, Authy, 1Password, etc.), or enter the secret manually, then confirm
                  with a code below.
                </p>
                <div className="rounded-md border border-border bg-bg-subtle p-3">
                  <p className="text-xs text-text-secondary">Secret (manual entry)</p>
                  <code className="text-sm text-text-primary">{secret}</code>
                </div>
                <div className="rounded-md border border-border bg-bg-subtle p-3">
                  <p className="text-xs text-text-secondary">otpauth:// URI</p>
                  <code className="break-all text-xs text-text-primary">{uri}</code>
                </div>
                <FieldGroup label="Confirmation code">
                  {(ids) => (
                    <Input
                      {...ids}
                      className="w-40 font-mono tracking-widest"
                      inputMode="numeric"
                      maxLength={6}
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value)}
                    />
                  )}
                </FieldGroup>
                <Button onClick={confirmEnroll} disabled={verifying || verifyCode.length !== 6}>
                  {verifying ? "Verifying…" : "Verify and enable"}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-text-secondary">
                  Add a second factor so signing in also requires a code from an authenticator app, not just your password.
                </p>
                <Button onClick={startEnroll} disabled={enrolling}>
                  {enrolling ? "Starting…" : "Set up 2FA"}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </Layout>
  );
}
