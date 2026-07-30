import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";

// Same small (40px) white-background render of the app icon as src/adapters/notify/content.ts's
// alert email, base64-inlined rather than linked. A remote image URL depends on guessing/deriving
// the right host correctly and on the recipient's mail client choosing to load remote images at
// all (most block them by default until the user clicks "show images") — inlining sidesteps both.
const LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAFV0lEQVR4nO2Yy4scVRTGf/dWVT+mp6fzMjEhKJnoiC5igpDEVxDBBEEk6EayigZxI4p/gI+dC0Fwo1kF3bgRxE0EF5IsFF2o+IiJwZjRSWYymZ5HT3e6q6vqPuRWDU4nZJoOKeMs/JqGrup76n51vnPPuecKa61lFUOyyiFZ5ZCscvg3ZT0OTC49xQAPZbfjExCUQRSB7cDIrfZgDHwN6hz8OZXdutJa/vtyAzoJTFwATgPfAuGt8uBZoA4TF6HeBCEV1XkfTywPiSKYnYG5hmZ2xqPqw+2XoViGwhOA+DcIOg/8CK05OH8JYq3xpMAYkAKC0vJQaUEnkEQgrGH2iqVe99iyHrZ+Af4+YChvic+DXoBT4xB2DUYJlAJf+KxdC16yPNT93lBxBC1xDMoItDRMzENnEYyTnpwJtheg1ck8oxUpuTiyDAVw7gyEo8tjSzvh/F9QHfJRicUom9okMUQakkZOErsiI0QWMHPT4IeOmF66ZykVPYyFseevttu0A9bebTnzocC3Ht1Y48qVC4cohO4cFPMg2BvNzcnsSrsVLCzGWEo+qBU0KJQFcQQ6giQBaxxBRXPWTx9Uu44Tbphgr11jBrxyFlcIicWmBMp90odnsnBIuhZX8Z0H63VoLsLWf+YQ+axi5zjbgsQ6cd0HrAftnvx3LRyppJulHetiwUITKHYHnfUGCLqUESUQi0xqJ7EKIFF9XqoDytlEFmtESjJSMFz4FwgWAlhsgXExZ00qV1wA2ycPNJvQDTOCbjW5l7IKyqWcCaqItFK0Q4WUJnWhC26lwF2uBCe/82KSGKzNYk3HmmrJy5dgewbChoulBCnF0mQW0wHRR64wTB2X5j8HF7cqjok6ZaImFEdyInhlBlqLTiqTrbqMX5o++mV6l/N8C3Gs05rgvG60pbWQvXRuBBcnHDlIQkM3Fml1KBYgKUKpT8MwV3fVBLS2GHRKzsSWjoXGBKy7K6dSV/8dGvNw7lQXpQxH3qqSxJaFOnT7ENz3pItbaNQ1M1OKSxci2h1NtwP1PwaZeUCCP38DpWF4+sh6dj9RoT6dcO+eClN/QOGaGOztwfYcgqcOwdlfO2y+Q/LIgTXM1xWXpmH8l5sk2DvR6J3w+LOg/Ll0//f64TMUi3DwMDx84Gq73srwygPZNuyN9zez6/ESid9g/3M1du/LdjuDQAzSdp58Ez77dJofTp1jw/oR0B7DaxIe27sTXVa8eOz6ofz2g9BqwX37Z/n84xka85axXR5bhseolSQvHc9J4g/e+43JyVm2bC0yVLZUaoZ2x/DVCYMor2w3tAk6IXxy9CKe57F5a4Gpcc1PPyzwzfd9auSNrmK/YhBBiBEaY7sIJKUybByWbLh9Zbu4qPAKknVbnOwRLtlURgS+bmOl2+FW8yEopU+oQoRwedA5PS0lhFFIcU2wohBDazSJjYlVdyk2l6qJDvA9ZzfA3IMMCpRPzY5htSTWIYnpkpiYSLUJSs4v10e5FqNNTKKj7GsUyvhUvFG6fTYZAxHsXTuvfrSZoBbie8NU5SjSDKGMRmuJoacZuQZKxQjjExuFZ2rUvO2UZRUzMsNrxwZrlleUuDdd3L+/zNHT24BtvPPCab47HiCoEUYLSG/Tig83WrKoFghMDVEU7DjY5uV3BygfvTz+P936T89mehGC/R6E2+rtdCuEXJCPxPMQnYTpOSgVQASw8RnXIK8SD9Z/h1+/hPFFkAHcVoRH90J1dJUQDJswPQlz7XSfjV+RaZOVB3IhWBmDiTrIGAIp+SuCEXcumANySzOLs5ruJQ/Xrmy4x+IHN3DG1gf/50FuEn8DUQaS78Bpux0AAAAASUVORK5CYII=";

/** The license-delivery email a customer receives from the /admin portal (website/api/admin/licenses.tsx)
 * and from the daily expiry-reminder cron. Rendered to a static HTML string via @react-email/render at
 * send time — email clients don't run JS or read stylesheets reliably, so every style here is inline,
 * and layout uses plain block elements rather than flex/grid (Outlook's Word-based renderer ignores both). */
export function LicenseEmail(props: {
  customer: string;
  planLabel: string;
  deviceLimit: number;
  expiryText: string;
  licenseFileName: string;
  licenseFile: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{`Your Argus license for ${props.customer} — ${props.planLabel}, ${props.deviceLimit} devices`}</Preview>
      <Body style={{ backgroundColor: "#f4f4f7", margin: 0, padding: "32px 16px", fontFamily: "Segoe UI, Helvetica, Arial, sans-serif" }}>
        <Container style={{ maxWidth: 520, margin: "0 auto", backgroundColor: "#ffffff", borderRadius: 16, overflow: "hidden", border: "1px solid #e5e5ea" }}>
          <Section style={{ padding: "28px 32px 20px", borderBottom: "1px solid #efeff4" }}>
            <Img src={LOGO_DATA_URI} width={32} height={32} alt="Argus" style={{ display: "inline-block", verticalAlign: "middle", borderRadius: 8 }} />
            <span style={{ display: "inline-block", verticalAlign: "middle", marginLeft: 10, fontSize: 17, fontWeight: 700, color: "#18181b" }}>
              Argus
            </span>
          </Section>

          <Section style={{ padding: "28px 32px 8px" }}>
            <Heading style={{ fontSize: 20, fontWeight: 700, color: "#18181b", margin: "0 0 16px" }}>
              Your Argus license is ready
            </Heading>
            <Text style={{ fontSize: 14, lineHeight: "22px", color: "#3f3f46", margin: "0 0 20px" }}>
              Hi {props.customer}, your license is attached ({props.licenseFileName}) and included below.
            </Text>

            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse", marginBottom: 20 }}>
              <tbody>
                {[
                  ["Plan", props.planLabel],
                  ["Devices", String(props.deviceLimit)],
                  ["Expires", props.expiryText],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ padding: "8px 0", fontSize: 13, color: "#71717a", width: 110, borderBottom: "1px solid #f4f4f7" }}>{label}</td>
                    <td style={{ padding: "8px 0", fontSize: 13, fontWeight: 600, color: "#18181b", borderBottom: "1px solid #f4f4f7" }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Text style={{ fontSize: 14, lineHeight: "22px", color: "#3f3f46", margin: "0 0 12px" }}>
              <strong>To apply it:</strong> open Argus, sign in as an admin, go to Settings → License, paste
              the text below into "Apply a license", and click Apply.
            </Text>

            <div
              style={{
                backgroundColor: "#18181b",
                color: "#e4e4e7",
                padding: 14,
                borderRadius: 10,
                fontFamily: "Consolas, Menlo, monospace",
                fontSize: 11,
                lineHeight: "16px",
                wordBreak: "break-all",
                whiteSpace: "pre-wrap",
                margin: "0 0 20px",
              }}
            >
              {props.licenseFile}
            </div>

            <Hr style={{ borderColor: "#efeff4", margin: "0 0 16px" }} />

            <Text style={{ fontSize: 13, lineHeight: "20px", color: "#71717a", margin: 0 }}>
              Questions? Just reply to this email.
            </Text>
          </Section>
        </Container>
        <Text style={{ fontSize: 11, color: "#a1a1aa", textAlign: "center", margin: "20px 0 0" }}>
          Sent by Argus — network monitoring that never blinks.
        </Text>
      </Body>
    </Html>
  );
}
