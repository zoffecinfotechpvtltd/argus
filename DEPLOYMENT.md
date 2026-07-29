# Deploying Argus from absolute zero

Follow this top to bottom if you're setting the whole business up on a brand-new machine/account —
fresh signing keys, fresh website deploy, fresh first sale. Every step that only ever happens once
is marked **(one-time)**; skip those on any machine that already has working keys and a deployed
site. For narrower questions ("how do I cut just the next release", "how does a customer install
this"), see [README.md](./README.md) instead — this file is the from-scratch runbook.

## Contents

- [0. Prerequisites](#0-prerequisites)
- [1. Get the code running locally](#1-get-the-code-running-locally)
- [2. Generate your signing keys (one-time)](#2-generate-your-signing-keys-one-time)
- [3. Build the first release](#3-build-the-first-release)
- [4. Deploy the website](#4-deploy-the-website)
- [5. Turn on auto-update for this release](#5-turn-on-auto-update-for-this-release)
- [6. Verify the whole thing end-to-end](#6-verify-the-whole-thing-end-to-end)
- [7. Make your first sale](#7-make-your-first-sale)
- [8. What the customer does](#8-what-the-customer-does)
- [9. Every release after this one](#9-every-release-after-this-one)
- [10. If you ever have to rotate a key](#10-if-you-ever-have-to-rotate-a-key)

---

## 0. Prerequisites

- **[Bun](https://bun.sh)** — the only runtime needed to build/run the backend. No Node.js.
- **Windows**, to build and test the exe (Argus itself only ships for Windows).
- **[Inno Setup](https://jrsoftware.org/isinfo.php)**, free — builds the wizard installer:
  ```bash
  winget install JRSoftware.InnoSetup
  ```
  Without it, `bun run release` still produces the portable exe, just not the installer — install
  it before your first real release.
- **A [Vercel](https://vercel.com) account** — hosts the marketing/download site and the license
  admin portal. Free tier is enough to start.
- **A Microsoft 365 / Azure AD tenant with admin rights** — needed once, for the mail-sending app
  registration used by both the contact form and the license-issuing portal.
- *(Optional)* **[GitHub CLI](https://cli.github.com)** (`gh`) if you want a public releases repo
  as a changelog/archive — not required for the site's own download button to work.
- *(Optional)* **[WinSW](https://github.com/winsw/winsw/releases)** (`WinSW-x64.exe`) — lets the
  installer register Argus as a Windows service automatically. Without it, the installer still
  works but a customer sees manual `--install-service` instructions on first run instead.

## 1. Get the code running locally

```bash
git clone <your-repo-url> argus
cd argus
bun install                      # backend deps
cd website && bun install && cd ..  # website deps

bun run test                     # full backend test suite — confirm a clean baseline
bun run dev                      # sanity-check: backend on :58070, hot-reload
```

## 2. Generate your signing keys (one-time)

Two independent Ed25519 keypairs, used for two unrelated things — do not reuse one for the other:

```bash
bun run scripts/generate-license-keypair.ts     # -> secrets/license-private-key.pem
bun run scripts/generate-release-keypair.ts     # -> secrets/release-private-key.pem
```

- **`license-private-key.pem`** signs every `.license.key` file you ever issue to a customer. The
  matching public key is baked into the exe (`src/domain/licensePublicKey.ts`) at build time, so
  regenerating this key means every previously-issued license file stops verifying — customers
  would need brand-new keys re-issued and re-applied. Only regenerate this if the key is actually
  compromised.
- **`release-private-key.pem`** signs the auto-update feed (`update-feed.json`). Losing it means
  existing installs can no longer receive signed auto-updates until you rotate it and get customers
  onto a build that trusts the new public key (see [§10](#10-if-you-ever-have-to-rotate-a-key)).

Both files land in `secrets/` (already gitignored — **never commit them**). Back both up somewhere
durable now, before you forget: a password manager, an encrypted archive, anything that survives
this machine dying. There is no recovery path for either key besides a backup.

## 3. Build the first release

```bash
bun run release
```

One command: cleans, runs the full test suite, builds the UI, compiles the exe, stamps
icon/version/company info onto it (set `COMPANY_NAME="Your Company"` before this command if you
want your own name instead of "Argus" stamped on the binary/installer), smoke-tests the compiled
binary in a real temp directory (spins it up, hits the API, creates a device, confirms it
persisted, kills it), writes a SHA-256 checksum, builds the Inno Setup installer if Inno Setup is
present, and copies fixed-name aliases into `website/public/downloads/`. If any step fails, nothing
broken reaches `dist/`.

Confirm you now have, under `dist/`:
- `Argus-Setup-vX.Y.Z-win-x64.exe` (+ `.sha256`) — what customers should download.
- `Argus-vX.Y.Z-win-x64.exe` (+ `.sha256`) — portable exe, no installer/service.
- Fixed-name copies of both, already duplicated into `website/public/downloads/`.

## 4. Deploy the website

`website/` is one Vercel project that serves three things at once: the marketing/download site,
the `/admin` license-issuing portal, and the `/api/contact` form handler.

1. **New Vercel project**, root directory `website/`. Connect it to your repo (or deploy manually
   with `vercel --prod` from inside `website/` if you'd rather not connect a git integration yet).
2. **Project Settings → Environment Variables** — set all of these before the first real deploy:

   | Variable | Purpose | Example |
   |---|---|---|
   | `VITE_CONTACT_EMAIL` | Shown publicly on the site | `sales@yourdomain.com` |
   | `VITE_COMPANY_NAME` | Shown in the footer | `Your Company Pvt Ltd` |
   | `VITE_COMPANY_URL` | Footer link, optional | `https://yourdomain.com` |
   | `ADMIN_ALLOWED_IPS` | **Required** for `/admin` to work at all — comma-separated IPs/CIDRs allowed to reach any admin API route. Unset = portal refuses all traffic (fails closed, not open). | `203.0.113.9, 198.51.100.0/24` |
   | `LICENSE_PRIVATE_KEY_PEM` | The exact contents of `secrets/license-private-key.pem` from step 2 | *(paste the whole PEM block)* |
   | `ADMIN_PASSWORD_HASH` | Output of `bun run scripts/hash-admin-password.ts "a real password"` — never store the plaintext | *(hash string)* |
   | `ADMIN_SESSION_SECRET` | Any long random string, e.g. `openssl rand -hex 32` | *(random hex)* |
   | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `MAIL_SENDER_UPN` | Microsoft Graph app-only mail credentials — see the Azure steps below | — |
   | `CONTACT_TO_EMAIL` | Where the contact form's mail lands | `sales@yourdomain.com` |
   | `CRON_SECRET` | Any long random string — authorizes the daily expiry-reminder cron | *(random hex)* |
   | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | *(Optional)* A Vercel KV / Upstash Redis store — without it, license issuing still works, you just lose the "previously issued" history list and login rate-limiting | — |

3. **Azure app registration (one-time)** — both the contact form and the `/admin` portal send mail
   through the same Microsoft Graph app-only credentials:
   1. **Azure Portal → Microsoft Entra ID → App registrations → New registration.** Any name.
      Single tenant. No redirect URI (this is a daemon/app-only flow, not interactive login).
   2. Note the **Application (client) ID** and **Directory (tenant) ID** from Overview.
   3. **Certificates & secrets → New client secret** → copy the **value** immediately (shown once)
      → this is `AZURE_CLIENT_SECRET`.
   4. **API permissions → Add a permission → Microsoft Graph → Application permissions →
      `Mail.Send`** → **Grant admin consent** for the tenant (only a tenant admin can do this;
      without it, application permissions silently don't work).
   5. Pick a real, licensed Microsoft 365 mailbox to send **as** (e.g. `noreply@yourdomain.com`) —
      Graph `sendMail` sends through a real mailbox, there's no anonymous relay. Set it as
      `MAIL_SENDER_UPN`.
4. Push to the branch Vercel deploys (or `vercel --prod`). `api/contact.ts` and everything under
   `api/admin/` are picked up automatically as serverless functions — no extra config.
5. Confirm the download button on the live site actually serves the file:
   `https://<your-site>/downloads/Argus-Setup-win-x64.exe` should download immediately, no login
   wall, from a signed-out browser or plain `curl`.

> **Never put a real secret value in any file that gets committed.** Every credential above goes
> into Vercel's own environment-variable UI, not into `website/.env` or any tracked file.

## 5. Turn on auto-update for this release

Signing has to happen **after** the file is reachable at its final public URL, since the signature
covers that URL — so this comes after step 4, not before:

```bash
bun run scripts/sign-release.ts --version 1.0.0 \
  --url https://<your-site>/downloads/Argus-Setup-win-x64.exe \
  --exe dist/Argus-v1.0.0-win-x64.exe \
  --notes "Initial release"
```

This writes `dist/update-feed.json`. Upload its contents somewhere publicly reachable over HTTPS —
this is the URL customers put into Settings → General → "Update check URL". Once that's set on a
customer's install, "Check for updates" / "Update now" starts working for them from this point on.

## 6. Verify the whole thing end-to-end

Before handing a copy to a real customer, run through this once (full list in `GUIDE.md` §11):

- [ ] Installer shows a real wizard, no console window ever, dashboard opens at `localhost:58070`
- [ ] Windows service ("Argus Monitoring") survives a reboot with nobody logged in
- [ ] Discovery finds real devices on a test subnet; adding them creates correct default checks
- [ ] Test email and test webhook (Settings → Notifications) actually arrive
- [ ] An unreachable device produces an alert within one poll cycle and the configured
      notification fires
- [ ] `https://<your-site>/downloads/...` downloads with no GitHub login prompt, signed out
- [ ] `https://<your-site>/admin` — login works, IP allowlist actually blocks an unlisted IP,
      issuing a license emails it correctly
- [ ] Trial mode caps at 5 devices; applying a real `.license.key` shows the right
      customer/plan/expiry and lifts the cap
- [ ] Check for updates → Update now completes end-to-end on a real machine (not just dev),
      using the feed you just signed in step 5

## 7. Make your first sale

1. Customer pays however you collect payment (bank transfer, UPI, invoice) — entirely outside the
   app; nothing in Argus processes payments.
2. Issue their license, any of three equivalent ways:
   - **CLI**, on your own machine:
     ```bash
     bun run scripts/generate-license.ts --customer "Acme Corp" --plan business --devices 150 --expires 2027-07-11
     ```
     (`--perpetual` instead of `--expires` for a one-time purchase.)
   - **Local UI**, on your own machine: `bun run license-admin` → opens `http://localhost:4790`,
     a form with the same fields. Never compiled into Argus.exe, never reachable off `127.0.0.1`.
   - **Hosted portal**, from anywhere: `https://<your-site>/admin` (needs step 4's env vars set) —
     same form, and it emails the `.license.key` straight to the customer on submit instead of you
     doing it by hand.
3. Whichever method, the customer ends up with a `.license.key` file (and, via the hosted portal,
   an email already containing it) plus a link to the download page.

## 8. What the customer does

Full walkthrough is in [README.md](./README.md#setting-argus-up-on-a-machine) — in short: run the
installer, create the admin account, run Discovery, configure Notifications, paste the license key
into Settings → License → Apply license. Nothing above requires anything from you at this point
except having sent the license.

## 9. Every release after this one

```bash
bun run release
bun run scripts/sign-release.ts --version X.Y.Z \
  --url https://<your-site>/downloads/Argus-Setup-win-x64.exe \
  --exe dist/Argus-vX.Y.Z-win-x64.exe \
  --notes "What changed"
git add package.json website/public/downloads/
git commit -m "vX.Y.Z: release"
git tag vX.Y.Z
git push origin main --tags
```

Push the updated `update-feed.json` contents to wherever your "Update check URL" points, and
existing customers see "Update available" next time they check — see
[README.md](./README.md#applying-updates-without-losing-data) for exactly what that update path
does and does not touch on the customer's machine.

## 10. If you ever have to rotate a key

- **Release-signing key compromised or lost:** generate a new one
  (`bun run scripts/generate-release-keypair.ts`), update whatever verifies it, and know that
  installs still running an old build won't trust a feed signed by the new key until they've
  received at least one update signed by whichever key they currently trust — plan a manual
  communication to customers for this, it isn't automatic.
- **License-signing key compromised:** every license you've ever issued was signed with it and
  will keep verifying against the old public key baked into already-shipped exes. Rotating this key
  only affects licenses issued *after* the rotation, on customers who've since updated to a build
  with the new public key compiled in — this is disruptive and worth avoiding rather than a routine
  operation.
