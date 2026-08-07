import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Server,
  Radar,
  Waypoints,
  Activity,
  Siren,
  FileBarChart2,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  Users,
  ScrollText,
  KeyRound,
  Settings,
  ShieldCheck,
  Lock,
  ChevronDown,
  X,
  Fingerprint,
  Globe,
  Shield,
  Target,
  Radio,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { ArgusMark } from "./ArgusMark";

const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/inventory", label: "Inventory", icon: Server },
  { to: "/discovery", label: "Discovery", icon: Radar },
  { to: "/map", label: "Map", icon: Waypoints },
  { to: "/bandwidth", label: "Bandwidth", icon: Activity },
  { to: "/firewalls", label: "Firewalls", icon: Shield },
  { to: "/alerts", label: "Alerts", icon: Siren },
  { to: "/sla", label: "SLA", icon: Target },
  { to: "/reports", label: "Reports", icon: FileBarChart2 },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/security", label: "Security", icon: Lock },
];

const ADMIN_ITEMS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/audit", label: "Audit Log", icon: ScrollText },
  { to: "/admin/license", label: "License", icon: KeyRound },
  { to: "/admin/api-keys", label: "API Keys", icon: KeyRound },
  { to: "/admin/remote-agents", label: "Remote Agents", icon: Radio },
  { to: "/admin/sso", label: "SSO / SAML", icon: Fingerprint },
  { to: "/admin/status-page", label: "Status Page", icon: Globe },
  { to: "/admin/settings", label: "General Settings", icon: Settings },
];

const COLLAPSE_KEY = "argus.sidebar.collapsed";
const ADMIN_OPEN_KEY = "argus.sidebar.adminOpen";

// Module-level, not component state — Layout (and therefore Sidebar) currently remounts on every
// route change (each page renders its own <Layout>, there's no persistent parent route/<Outlet>
// wrapping them), so any state that lived only in a useState here reset to its initial value on
// every single navigation. A module-level variable survives a remount — it's only reset by an
// actual full page reload, which is the behavior someone actually expects from "restore my scroll
// position," not "reset every time I click a nav link."
let savedNavScrollTop = 0;

/**
 * Active state per steps/04-component-spec.md: `bg-accent-subtle` background + `text-accent`,
 * `radius-md`, plain color transition — no animated pill, no spring/bounce easing. The active row
 * change is a plain 120ms color fade, the same as every other hover/focus state in the app.
 */
function NavItem({ to, label, icon: Icon, collapsed, end }: { to: string; label: string; icon: LucideIcon; collapsed: boolean; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface ${
          isActive ? "bg-accent-subtle text-accent" : "text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
        } ${collapsed ? "justify-center" : ""}`
      }
    >
      <Icon size={17} className="shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

export function Sidebar({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const { user, mode } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [adminOpen, setAdminOpen] = useState(
    () => localStorage.getItem(ADMIN_OPEN_KEY) === "1" || location.pathname.startsWith("/admin"),
  );
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(ADMIN_OPEN_KEY, adminOpen ? "1" : "0");
  }, [adminOpen]);

  useEffect(() => {
    onCloseMobile();
  }, [location.pathname]);

  // Restore scroll position lost on every remount (see savedNavScrollTop above), then keep
  // tracking it so the next remount can restore it too.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    el.scrollTop = savedNavScrollTop;
    const onScroll = () => {
      savedNavScrollTop = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const isAdmin = user?.role === "admin";

  function renderBody(variant: "desktop" | "mobile") {
    return (
      <div className={`flex h-full flex-col bg-bg-surface ${collapsed ? "w-16" : "w-[232px]"} transition-[width] duration-200 ease-out-expo`}>
        <div className={`flex items-center gap-2.5 border-b border-border px-4 py-5 ${collapsed ? "justify-center px-2" : ""}`}>
          <ArgusMark size={collapsed ? 26 : 30} />
          {!collapsed && <span className="truncate text-lg font-semibold text-text-primary">ARGUS</span>}
          <button
            onClick={onCloseMobile}
            aria-label="Close menu"
            className="ml-auto cursor-pointer rounded-md p-1 text-text-secondary transition-colors duration-micro hover:bg-bg-subtle hover:text-text-primary lg:hidden"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav ref={navRef} className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}

          {isAdmin && (
            <div className="pt-2">
              {!collapsed && <div className="mb-1.5 px-3 text-2xs font-medium uppercase tracking-tight text-text-muted">Admin</div>}
              <button
                onClick={() => {
                  if (collapsed) setCollapsed(false);
                  setAdminOpen((o) => !o);
                }}
                title={collapsed ? "Admin" : undefined}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors duration-micro hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface ${
                  collapsed ? "justify-center" : ""
                }`}
              >
                <ShieldCheck size={17} className="shrink-0" aria-hidden="true" />
                {!collapsed && (
                  <>
                    <span className="truncate">Admin tools</span>
                    <ChevronDown size={14} className={`ml-auto shrink-0 transition-transform duration-micro ${adminOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </>
                )}
              </button>
              {!collapsed && (
                <motion.div
                  initial={false}
                  animate={{ height: adminOpen ? "auto" : 0, opacity: adminOpen ? 1 : 0 }}
                  transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                  className="overflow-hidden"
                >
                  <div className="relative mt-1 space-y-0.5 pl-3">
                    <div className="absolute bottom-2 left-[5px] top-2 w-px bg-border" aria-hidden="true" />
                    {ADMIN_ITEMS.filter((item) => mode !== "exe" || item.to !== "/admin/sso").map((item) => (
                      <NavItem key={item.to} {...item} collapsed={false} />
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </nav>

        <div className="border-t border-border p-3">
          {!collapsed && user && (
            <div className="mb-2 flex items-center gap-2 rounded-md px-1 py-1">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-2xs font-semibold text-accent">
                {user.email.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-2xs font-medium text-text-primary">{user.email}</div>
                <div className="truncate text-2xs capitalize text-text-muted">{user.role}</div>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={`hidden w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-2xs font-medium text-text-secondary transition-colors duration-micro hover:bg-bg-subtle hover:text-text-primary lg:flex ${
              collapsed ? "justify-center" : ""
            }`}
          >
            {collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <aside className="sticky top-0 hidden h-screen shrink-0 border-r border-border lg:block">{renderBody("desktop")}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={onCloseMobile} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 border-r border-border shadow-lg">{renderBody("mobile")}</div>
        </div>
      )}
    </>
  );
}
