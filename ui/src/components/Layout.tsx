import { useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { CommandPalette } from "./CommandPalette";
import { ContextBar } from "./ContextBar";
import { KioskLayout } from "./KioskLayout";
import { LicenseBanner } from "./LicenseBanner";
import { PageHeader } from "./PageHeader";
import { Sidebar } from "./Sidebar";
import { useKioskMode } from "../hooks/useKioskMode";

export function Layout({ children, title, subtitle, action }: { children: ReactNode; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const kiosk = useKioskMode();

  if (kiosk.active) {
    return <KioskLayout>{children}</KioskLayout>;
  }

  return (
    <div className="flex min-h-screen bg-bg-canvas text-text-primary">
      <CommandPalette />
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {user?.role === "admin" && <LicenseBanner />}
        <ContextBar title={title} onOpenMobile={() => setMobileOpen(true)} onEnterKiosk={kiosk.enter} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <PageHeader subtitle={subtitle} action={action} />
          {children}
        </main>
      </div>
    </div>
  );
}
