import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import { api, setCsrfToken, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, FieldGroup, Input } from "../components/ui";
import { AuthEyebrow, AuthShell, fieldVariants, staggerContainer } from "../components/AuthShell";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const navigate = useNavigate();
  const { refresh, mode } = useAuth();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ csrfToken: string }>("/auth/login", {
        email,
        password,
        ...(totpRequired ? { totpCode } : {}),
      });
      setCsrfToken(res.csrfToken);
      await refresh();
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError && err.code === "TOTP_REQUIRED") {
        setTotpRequired(true);
      } else if (err instanceof ApiError && err.code === "RATE_LIMITED") {
        setError("Too many attempts, try again shortly.");
      } else if (err instanceof ApiError && err.code === "ACCOUNT_LOCKED") {
        setError("Too many failed attempts — this account is temporarily locked. Try again in a few minutes.");
      } else if (err instanceof ApiError && err.code === "INVALID_TOTP") {
        setError("That code didn't work — check your authenticator app and try again.");
      } else {
        setError("Invalid email or password");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthEyebrow>Sign in</AuthEyebrow>
      <h1 className="font-display text-2xl font-bold tracking-tightest text-text-primary">Welcome back</h1>
      <p className="mb-6 mt-1 text-sm text-text-secondary">Your network's been running while you were away.</p>

      <motion.form variants={staggerContainer} initial="hidden" animate="visible" onSubmit={handleSubmit} className="space-y-4">
        {!totpRequired ? (
          <>
            <motion.div variants={fieldVariants}>
              <FieldGroup label="Email">
                {(ids) => <Input {...ids} className="w-full" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </FieldGroup>
            </motion.div>
            <motion.div variants={fieldVariants}>
              <FieldGroup label="Password">
                {(ids) => (
                  <div className="relative">
                    <Input
                      {...ids}
                      className="w-full pr-10"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={(e) => setCapsLockOn(e.getModifierState?.("CapsLock") ?? false)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-text-secondary transition-colors duration-micro hover:text-text-primary"
                    >
                      {showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                    </button>
                  </div>
                )}
              </FieldGroup>
              {capsLockOn && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle size={12} aria-hidden="true" /> Caps Lock is on
                </p>
              )}
              <Link to="/forgot-password" className="mt-1.5 inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80">
                Forgot password?
              </Link>
            </motion.div>
          </>
        ) : (
          <motion.div variants={fieldVariants}>
            <FieldGroup label="Authenticator code" hint="Enter the 6-digit code from your authenticator app.">
              {(ids) => (
                <Input
                  {...ids}
                  className="w-full font-mono tracking-widest"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoFocus
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                />
              )}
            </FieldGroup>
          </motion.div>
        )}
        {error && (
          <motion.p variants={fieldVariants} role="alert" className="text-sm text-critical">
            {error}
          </motion.p>
        )}
        <motion.div variants={fieldVariants}>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in…" : totpRequired ? "Verify" : "Sign in"}
          </Button>
        </motion.div>
        {mode === "saas" && !totpRequired && (
          <motion.div variants={fieldVariants}>
            <Link to="/signup" className="block">
              <Button type="button" variant="secondary" className="w-full">
                New here? Create an account
              </Button>
            </Link>
          </motion.div>
        )}
      </motion.form>
    </AuthShell>
  );
}
