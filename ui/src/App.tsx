import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { WebSocketProvider } from "./ws/WebSocketProvider";
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Signup } from "./pages/Signup";
import { ResetPassword } from "./pages/ResetPassword";
import { SettingsSecurity } from "./pages/SettingsSecurity";
import { Setup } from "./pages/Setup";
import { Dashboard } from "./pages/Dashboard";
import { Discovery } from "./pages/Discovery";
import { Bandwidth } from "./pages/Bandwidth";
import { Firewalls } from "./pages/Firewalls";
import { Inventory } from "./pages/Inventory";
import { Alerts } from "./pages/Alerts";
import { SettingsNotifications } from "./pages/SettingsNotifications";
import { DeviceDetail } from "./pages/DeviceDetail";
import { Topology } from "./pages/Topology";
import { Reports } from "./pages/Reports";
import { Sla } from "./pages/Sla";
import { Users } from "./pages/Users";
import { AuditLog } from "./pages/AuditLog";
import { SettingsGeneral } from "./pages/SettingsGeneral";
import { SettingsLicense } from "./pages/SettingsLicense";
import { AdminApiKeys } from "./pages/AdminApiKeys";
import { StatusPage } from "./pages/StatusPage";
import { SettingsSso } from "./pages/SettingsSso";
import { SettingsStatusPage } from "./pages/SettingsStatusPage";
import { ToastProvider, ConfirmProvider } from "./components/ui";
import { OnboardingTour } from "./components/onboarding/OnboardingTour";

function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading, setupRequired } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-bg-canvas text-text-secondary">Loading…</div>;
  }
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, loading, setupRequired } = useAuth();
  if (loading) return null;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading, setupRequired } = useAuth();
  if (loading) return null;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <WebSocketProvider>
              <Routes>
                {/* M6: the only route in this app with no auth gate at all — not even PublicOnly's
                    "redirect away if logged in" (an admin should be able to open their own status
                    page the same as anyone else). See StatusPage.tsx: it fetches its own data and
                    never touches AuthContext. */}
                <Route path="/status/:tenantSlug" element={<StatusPage />} />
                <Route
                  path="/setup"
                  element={
                    <SetupOnly>
                      <Setup />
                    </SetupOnly>
                  }
                />
                <Route
                  path="/login"
                  element={
                    <PublicOnly>
                      <Login />
                    </PublicOnly>
                  }
                />
                <Route
                  path="/signup"
                  element={
                    <PublicOnly>
                      <Signup />
                    </PublicOnly>
                  }
                />
                <Route
                  path="/forgot-password"
                  element={
                    <PublicOnly>
                      <ForgotPassword />
                    </PublicOnly>
                  }
                />
                <Route
                  path="/reset-password"
                  element={
                    <PublicOnly>
                      <ResetPassword />
                    </PublicOnly>
                  }
                />
                <Route
                  path="/settings/security"
                  element={
                    <Gate>
                      <SettingsSecurity />
                    </Gate>
                  }
                />
                <Route
                  path="/"
                  element={
                    <Gate>
                      <Dashboard />
                    </Gate>
                  }
                />
                <Route
                  path="/inventory"
                  element={
                    <Gate>
                      <Inventory />
                    </Gate>
                  }
                />
                <Route
                  path="/discovery"
                  element={
                    <Gate>
                      <Discovery />
                    </Gate>
                  }
                />
                <Route
                  path="/bandwidth"
                  element={
                    <Gate>
                      <Bandwidth />
                    </Gate>
                  }
                />
                <Route
                  path="/firewalls"
                  element={
                    <Gate>
                      <Firewalls />
                    </Gate>
                  }
                />
                <Route
                  path="/alerts"
                  element={
                    <Gate>
                      <Alerts />
                    </Gate>
                  }
                />
                <Route
                  path="/settings/notifications"
                  element={
                    <Gate>
                      <SettingsNotifications />
                    </Gate>
                  }
                />
                <Route
                  path="/devices/:id"
                  element={
                    <Gate>
                      <DeviceDetail />
                    </Gate>
                  }
                />
                <Route
                  path="/map"
                  element={
                    <Gate>
                      <Topology />
                    </Gate>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <Gate>
                      <Reports />
                    </Gate>
                  }
                />
                <Route
                  path="/sla"
                  element={
                    <Gate>
                      <Sla />
                    </Gate>
                  }
                />
                <Route
                  path="/admin/users"
                  element={
                    <AdminGate>
                      <Users />
                    </AdminGate>
                  }
                />
                <Route
                  path="/admin/audit"
                  element={
                    <AdminGate>
                      <AuditLog />
                    </AdminGate>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={
                    <AdminGate>
                      <SettingsGeneral />
                    </AdminGate>
                  }
                />
                <Route
                  path="/admin/license"
                  element={
                    <AdminGate>
                      <SettingsLicense />
                    </AdminGate>
                  }
                />
                <Route
                  path="/admin/api-keys"
                  element={
                    <AdminGate>
                      <AdminApiKeys />
                    </AdminGate>
                  }
                />
                <Route
                  path="/admin/sso"
                  element={
                    <AdminGate>
                      <SettingsSso />
                    </AdminGate>
                  }
                />
                <Route
                  path="/admin/status-page"
                  element={
                    <AdminGate>
                      <SettingsStatusPage />
                    </AdminGate>
                  }
                />
              </Routes>
              <OnboardingTour />
            </WebSocketProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function SetupOnly({ children }: { children: React.ReactNode }) {
  const { setupRequired, loading } = useAuth();
  if (loading) return null;
  if (!setupRequired) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
