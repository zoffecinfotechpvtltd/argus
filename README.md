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
Tailwind + Recharts frontend, compiled together into one native Windows binary.

**Business model:** sell a copy directly, collect payment however you choose (bank transfer, UPI,
invoice — entirely outside the app), issue a signed license file for a device-range plan, email it
to the customer along with the installer. No self-service signup, no recurring billing inside the
product itself.

## Contents

- [Setting Argus up on a machine](#setting-argus-up-on-a-machine)
- [Applying updates without losing data](#applying-updates-without-losing-data)
- [Mail setup #1 — alert emails from the running app](#mail-setup-1--alert-emails-from-the-running-app)
- [Mail setup #2 — the website's contact form](#mail-setup-2--the-websites-contact-form)
- [Building from source](#building-from-source)
- [Cutting a release](#cutting-a-release)
- [Everything else](#everything-else)

---

## Setting Argus up on a machine

**Requirements:** Windows 10 or 11, 64-bit, administrator rights to install (needed once, to
register the background service).

1. Download `Argus-Setup-vX.Y.Z-win-x64.exe` (and, optionally, its `.sha256` to verify with
   `Get-FileHash .\Argus-Setup-vX.Y.Z-win-x64.exe -Algorithm SHA256`).
2. Run it. A normal Windows installer wizard opens — pick an install folder, optionally choose a
   different **data location** (see below), optionally tick "Create a desktop shortcut," and
   finish. No console window at any point. Argus installs itself as a background Windows service
   (starts now, and automatically on every future boot) and offers to open the dashboard in your
   browser.
3. The dashboard opens at `http://localhost:58070`. Create the admin account (email + password,
   10+ characters) and accept the terms.
4. **Discovery** → enter the subnet (e.g. `192.168.1.0/24`) → Start scan → review results → Add
   devices. Monitoring more than one site/subnet over a VPN? See `GUIDE.md` §5 first — reachability
   depends on real network routing, not anything Argus can work around.
5. **Settings → Notifications** → configure SMTP and/or a webhook, send a test to confirm delivery
   — see [Mail setup #1](#mail-setup-1--alert-emails-from-the-running-app) below.
6. *(Optional, multi-person teams)* **Admin → Users** → invite Tier 1/2/3 contacts, then
   **Inventory** → set up each group's escalation chain (`GUIDE.md` §9.7).
7. **Settings → License** → paste the `.license.key` file's contents you received by email → Apply
   license.
8. To reopen the dashboard later, use the "Argus Dashboard" shortcut (Start Menu/desktop) — Argus
   is already running in the background, this just opens a browser tab. To fully remove Argus, use
   "Uninstall Argus" from the Start Menu or Windows Settings → Apps — this stops and removes the
   service **but leaves your data folder behind** in case you reinstall later.

**Where everything lives** (next to `Argus.exe`, by default `Program Files\Argus`):

| Path | Contents |
|---|---|
| `data/argus.db` (+ `-shm`/`-wal`) | The SQLite database — devices, metrics, alerts, users, settings |
| `data/instance.key` | Per-install key used to encrypt stored secrets (e.g. SNMP credentials) |
| `data/license.key` | The currently-applied license file |
| `data/logs/argus.log` | Application log |
| `config.json` | Instance config (port, data dir, log level, update-feed URL, etc.) |

---

## Applying updates without losing data

**Short answer: yes, there's a built-in update mechanism, and no, your data is never touched by
it.** Neither of the two update paths below goes anywhere near `data/` or `config.json`.

### How a customer applies a patch

Once you (the seller) have published a new signed build, the customer sees it two ways:

**Path A — in-app auto-update (no reinstall):** Settings → General → "Check for updates". If a
newer version is available, "Update now" downloads the new exe, verifies it two ways — an Ed25519
**signature** (proves it genuinely came from you, not just "a file with the right hash") and a
SHA-256 **checksum** — then hands off to a small detached helper script that waits for Argus to
exit, swaps the exe file, and restarts it. Whole thing takes about 10 seconds. This never touches
`data/`, `config.json`, or anything else in the install folder except the exe itself.
- If Argus is running as the Windows service (the normal case after using the installer), this
  path deliberately **refuses** and shows `SERVICE_INSTALLED` — swapping the exe out from under
  Windows' own service manager mid-restart would race it. In that case: stop the "Argus Monitoring"
  service, replace the exe by hand, start it again — or just use Path B.

**Path B — run the new installer over the old one (no uninstall needed):** download the new
`Argus-Setup-vX.Y.Z-win-x64.exe` and run it directly on top of an existing install. The installer
stops the service, overwrites the exe, and restarts the service — same result as Path A, without
needing the app to be online to trigger it. Because `config.json` already exists from the first
install, the installer **skips re-asking where your data lives** and keeps using the same `data/`
folder. Nothing in `data/` is deleted or modified by an upgrade install, and even a full
**uninstall** deliberately leaves `data/` behind, specifically so a reinstall (or this exact update
path) picks the existing database back up with nothing lost.

### As the seller, publishing an update

```bash
bun run release                                  # builds+tests+compiles the new version
bun run scripts/sign-release.ts --version 1.2.0 \
  --url https://your-host/Argus-Setup-v1.2.0-win-x64.exe \
  --exe dist/Argus-v1.2.0-win-x64.exe \
  --notes "What changed in this release"
```

The second command writes `dist/update-feed.json` — upload it wherever your customers' "Update
check URL" setting points (must be `https://`). Customers with that URL configured see "Update
available" next time they check. Losing the release-signing key (`secrets/release-private-key.pem`,
generated once via `bun run scripts/generate-release-keypair.ts`, gitignored) means you can't sign
new updates for machines already running an old build — back it up somewhere durable.

---

## Mail setup #1 — alert emails from the running app

This is the mail flow **inside the product itself** — the email a device owner or an escalation
tier contact receives when something goes down. Configured per-install, no code or redeploy
involved, entirely from the dashboard:

1. Sign in as an admin → **Settings → Notifications**.
2. Fill in the **SMTP** card (instance-wide, admin-only):

   | Field | Example |
   |---|---|
   | Host | `smtp.office365.com` / `smtp.gmail.com` / your provider's SMTP host |
   | Port | `587` (STARTTLS) or `465` (implicit TLS) |
   | Secure | on for port 465, off for 587 |
   | Username | `alerts@yourcompany.com` |
   | Password | an app password / SMTP credential from your provider — not usually your normal login password |
   | From address | `alerts@yourcompany.com` |

3. Click **Send test** — confirms delivery before relying on it.
4. Each user then sets their own delivery preferences further down the same page (which channels,
   minimum severity, quiet hours) — the instance-wide SMTP card only controls *how* mail goes out,
   not *who* gets what.
5. *(Optional)* Also fill in the **Webhook** card if you want alerts posted to Slack/Teams/your own
   endpoint instead of (or as well as) email — supports an optional HMAC signing secret so your
   receiving endpoint can verify the payload really came from this Argus instance.

Nothing here ever leaves the customer's own machine except the outbound SMTP connection they
configured — Argus has no mail server of its own and sends nothing anywhere by default.

---

## Mail setup #2 — the website's contact form

This is a **separate, one-time setup** for you as the seller — it's what sends *you* an email when
a prospect submits the "Talk to sales" form on the marketing site (`website/`), and is unrelated to
what any customer's installed copy of Argus does. It sends through Microsoft Graph (app-only auth),
never a mailbox password, so it needs a one-time Microsoft 365 / Azure AD admin setup:

1. **Azure Portal → Microsoft Entra ID → App registrations → New registration.** Any name (e.g.
   "Argus Website Contact Form"). Single tenant is fine. No redirect URI needed — this is a
   daemon/app-only flow, not an interactive login.
2. Note the **Application (client) ID** and **Directory (tenant) ID** from the app's Overview page.
3. **Certificates & secrets → New client secret** → copy the secret **value** immediately (shown
   once).
4. **API permissions → Add a permission → Microsoft Graph → Application permissions → `Mail.Send`**
   → then **Grant admin consent** for the tenant (only a tenant admin can click this; application
   permissions silently don't work without it).
5. Pick a real mailbox the app will send **as** (e.g. `noreply@yourdomain.com`) — it needs an
   actual Microsoft 365 mailbox license, since Graph `sendMail` sends through a real mailbox, there
   is no anonymous relay.
6. In your Vercel project (Project Settings → Environment Variables), set:

   | Variable | Example value |
   |---|---|
   | `AZURE_TENANT_ID` | `11111111-2222-3333-4444-555555555555` |
   | `AZURE_CLIENT_ID` | `66666666-7777-8888-9999-000000000000` |
   | `AZURE_CLIENT_SECRET` | *(the secret value from step 3 — never commit this anywhere)* |
   | `MAIL_SENDER_UPN` | `noreply@yourdomain.com` |
   | `CONTACT_TO_EMAIL` | `sales@yourdomain.com` |
   | `VITE_CONTACT_EMAIL` | `sales@yourdomain.com` *(shown publicly on the site itself)* |

Without all of these set, submitting the form returns a clear error telling the visitor to email
you directly — it never fails silently or claims success without actually sending. See `GUIDE.md`
§9.6 for the rest of the website's Vercel deploy variables (admin-portal license issuing, etc.).

> **Never commit real values for any of the above.** Set them in Vercel's own environment-variable
> UI (or your local, gitignored `.env`) — never hardcode a real client secret, connection string,
> or password into a file that gets pushed to git.

---

## Building from source

Requires [Bun](https://bun.sh) — no Node.js needed.

```bash
bun install
bun run dev          # backend on :58070 (watch mode), Vite on its own port
bun run test         # full test suite
bun run lint         # ESLint, including the hexagonal-boundary rule
```

## Cutting a release

```bash
bun run release
```

Cleans, runs the full test suite, builds the UI, compiles the exe, stamps icon/version info onto
it, smoke-tests the compiled binary end-to-end, writes a checksum, builds the Inno Setup installer,
and publishes fixed-name aliases the website's Download button always serves. See `GUIDE.md` §7–§8
for one-time setup (license/release signing keypairs, Inno Setup, WinSW).

---

## Everything else

**→ [GUIDE.md](./GUIDE.md)** is the full handbook: architecture, every page and what it does,
security posture, the multi-site/VPN deployment question, hosting the download site, issuing
licenses, a pre-sale verification checklist, troubleshooting, and the complete CLI/env-var/file
reference.
