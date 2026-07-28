// Release info is env-driven so a new Argus version doesn't need a code change here — just update
// this at deploy time (Vercel project env vars). See ../GUIDE.md §9.6. Deliberately no version/size
// display on the site itself — the download link always serves the latest build regardless.
export const RELEASE = {
  // Same-origin static file under website/public/downloads/ — served directly by Vercel's CDN,
  // so clicking Download always triggers an immediate file download with zero redirects and no
  // GitHub dependency (a GitHub Releases redirect 404s for anyone if the release/asset isn't
  // published, which is exactly what was happening before). Re-uploaded by scripts/release.ts
  // "Publish stable-name aliases" on every release — same fixed filename every time.
  downloadUrl: import.meta.env.VITE_DOWNLOAD_URL || "/downloads/Argus-Setup-win-x64.exe",
};

// Single source of truth for the contact identity shown across Navbar/Contact/Footer — was
// previously the literal string "sales@ztplsolutions.com" hardcoded in four separate files, so
// changing it meant editing all four (and the deployed site could drift from api/contact.ts's own
// CONTACT_TO_EMAIL, which is where the form's messages actually land). Set VITE_CONTACT_EMAIL (and
// optionally VITE_COMPANY_NAME/VITE_COMPANY_URL) at deploy time; the fallback below is a generic
// placeholder, not a real inbox — the site should never ship with a wrong or stale email baked in.
export const SITE = {
  contactEmail: import.meta.env.VITE_CONTACT_EMAIL || "sales@ztplsolutions.com",
  companyName: import.meta.env.VITE_COMPANY_NAME || "",
  companyUrl: import.meta.env.VITE_COMPANY_URL || "",
};
