// Shared Microsoft Graph app-only mail sender — used by api/contact.ts (sales inquiries) and
// api/admin/licenses.ts (emailing an issued license to the customer). See ../GUIDE.md §9.6
// "Azure setup" for how to obtain the AZURE_* credentials this needs.
import { ConfidentialClientApplication } from "@azure/msal-node";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

let cachedApp: ConfidentialClientApplication | null = null;
function getMsalApp(): ConfidentialClientApplication {
  if (cachedApp) return cachedApp;
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Azure credentials not configured (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET)");
  }
  cachedApp = new ConfidentialClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret },
  });
  return cachedApp;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  replyTo?: { address: string; name?: string };
  attachments?: { name: string; contentBase64: string; contentType?: string }[];
}

/** Sends via the mailbox configured as MAIL_SENDER_UPN. Throws on any failure — callers decide
 * how to surface that (never silently claim success, per this site's existing contact-form rule). */
export async function sendMail(input: SendMailInput): Promise<void> {
  const senderUpn = process.env.MAIL_SENDER_UPN;
  if (!senderUpn) throw new Error("MAIL_SENDER_UPN not configured");

  const msal = getMsalApp();
  const tokenResponse = await msal.acquireTokenByClientCredential({ scopes: [GRAPH_SCOPE] });
  if (!tokenResponse?.accessToken) throw new Error("Could not acquire Graph token");

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUpn)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenResponse.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "HTML", content: input.html },
        toRecipients: [{ emailAddress: { address: input.to } }],
        ...(input.replyTo ? { replyTo: [{ emailAddress: input.replyTo }] } : {}),
        ...(input.attachments
          ? {
              attachments: input.attachments.map((a) => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: a.name,
                contentType: a.contentType ?? "text/plain",
                contentBytes: a.contentBase64,
              })),
            }
          : {}),
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Graph sendMail failed: ${res.status} ${detail}`);
  }
}
