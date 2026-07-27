# Argus

**Network monitoring that ships in one file.**

Argus discovers devices on a network, monitors them continuously (ICMP, TCP, HTTP/HTTPS, SNMP),
raises alerts the moment something goes down or degrades, and notifies the right people by email
or webhook — walking a tiered escalation chain (Tier 1 → Tier 2 → Tier 3…) if nobody acknowledges
in time. It ships as a single Windows installer: run the wizard once and Argus installs itself as
a background service — no console window, no agents to deploy anywhere, nothing to keep open, and
it keeps running across logout/reboot. Everything it stores (inventory, metrics history, alerts,
settings) lives in one local SQLite database next to the exe. No account, no cloud dependency, no
internet connection required to run it.

**Stack:** Bun + TypeScript backend (Hono, `bun:sqlite`, no Node.js runtime needed), React + Vite +
Tailwind + Recharts frontend, compiled together into one native Windows binary. Hexagonal
architecture (`domain/ → application/ → ports/ ← adapters/`, `api/`, `bootstrap/`), enforced by an
ESLint boundary rule.

**Business model:** sell a copy directly, collect payment however you choose (bank transfer, UPI,
invoice — entirely outside the app), issue a signed license file for a device-range plan, email it
to the customer along with the installer. No self-service signup, no recurring billing inside the
product itself.

## Everything else lives in one place

**→ [GUIDE.md](./GUIDE.md)** — the full handbook: every page and what it does, security posture,
building from source, cutting a release, hosting the download site, issuing licenses, the
multi-site/VPN deployment question, a client setup walkthrough, a pre-sale verification checklist,
troubleshooting, and the full CLI/env-var/file-location reference.

## Quick links

- Building from source / running tests → [GUIDE.md §7](./GUIDE.md#7-building-from-source)
- Cutting a release → [GUIDE.md §8](./GUIDE.md#8-cutting-a-release)
- Issuing a license after a sale → [GUIDE.md §10.2](./GUIDE.md#102-the-manual-sale-workflow-start-to-finish)
- "Will this monitor devices across 4 offices over one VPN?" → [GUIDE.md §5](./GUIDE.md#5-network-reachability--multi-site--vpn-deployments)
- Security posture → [GUIDE.md §6](./GUIDE.md#6-security-posture)
