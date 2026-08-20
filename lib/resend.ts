import { Resend } from "resend";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { siteConfig } from "@/lib/config";

const theme = {
  bg: "#EAF0F5",
  surface: "#FFFFFF",
  surfaceRaised: "#EEF2F5",
  hairline: "#D7DEE4",
  ink: "#2E3942",
  muted: "#5A6B7A",
  blue: "#336791",
  blueDark: "#27557A",
  amber: "#8A5A1E",
};

export async function sendRegistrationThankYouEmail(input: {
  name: string;
  email: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { env } = getCloudflareContext();

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping thank-you email");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const from = env.EMAIL_FROM ?? `PG Day Egypt <${siteConfig.organizer.contactEmail}>`;
  const siteUrl = env.SITE_URL ?? "https://pgegypt.org";

  const resend = new Resend(apiKey);

  const subject = "You're registered for PG Day Egypt 2026 🎉";

  const text = [
    `Hi ${input.name},`,
    "",
    `Thanks for registering for PG Day Egypt 2026 — Egypt's first PostgreSQL community conference, happening Saturday, October 10, 2026 in Cairo.`,
    "",
    "We've received your registration. We'll follow up closer to the event with confirmation details and venue information as soon as they're finalized.",
    "",
    "In the meantime, check out the full schedule and speaker lineup:",
    `  • Schedule: ${siteUrl}/schedule`,
    `  • Speakers: ${siteUrl}/speakers`,
    "",
    "See you there,",
    "The PG Day Egypt Team",
  ].join("\n");

  const html = buildHtmlEmail({
    name: input.name,
    siteUrl,
  });

  try {
    const { error } = await resend.emails.send({
      from,
      to: input.email,
      subject,
      text,
      html,
    });

    if (error) {
      console.error("[email] Resend error:", error);
      return { ok: false, error: String(error.message ?? error) };
    }

    return { ok: true };
  } catch (err) {
    console.error("[email] Failed to send thank-you email:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const button = (href: string, label: string, primary: boolean) => `
  <a href="${href}" style="
    display:inline-block;
    padding:10px 22px;
    border:1px solid ${primary ? theme.blue : theme.hairline};
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:14px;
    font-weight:600;
    text-decoration:none;
    margin:0 6px 8px 0;
    ${primary ? `background-color:${theme.blue};color:#FFFFFF;` : `background-color:${theme.surface};color:${theme.blue};`}
  ">${label}</a>
`;

export function buildHtmlEmail(input: { name: string; siteUrl: string }): string {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>You're registered for PG Day Egypt 2026</title>
</head>
<body style="margin:0;padding:0;background-color:${theme.bg};">
  <div role="article" aria-roledescription="email" lang="en" style="
    background-color:${theme.bg};
    padding:32px 16px;
  ">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
      <tr>
        <td>

          <!-- Header -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr>
              <td style="padding:0 4px 12px;border-bottom:2px solid ${theme.blue};">
                <span style="
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  font-size:20px;
                  font-weight:700;
                  color:${theme.ink};
                ">PG&nbsp;Day&nbsp;Egypt</span>
                <span style="
                  font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
                  font-size:12px;
                  color:${theme.blue};
                  letter-spacing:0.08em;
                ">2026</span>
              </td>
            </tr>
          </table>

          <!-- Card -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="
            background-color:${theme.surface};
            border:1px solid ${theme.hairline};
          ">
            <tr>
              <td style="padding:32px 32px 8px;">

                <p style="
                  margin:0 0 16px;
                  font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
                  font-size:12px;
                  letter-spacing:0.04em;
                  color:${theme.blue};
                ">$ SELECT * FROM attendees WHERE email = '${escapeHtml(input.name.trim())}';</p>

                <h1 style="
                  margin:0 0 12px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  font-size:24px;
                  line-height:1.3;
                  font-weight:700;
                  color:${theme.blue};
                ">Thanks for registering, ${firstName}!</h1>

                <p style="
                  margin:0 0 14px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  font-size:15px;
                  line-height:1.6;
                  color:${theme.muted};
                ">
                  We've received your registration for
                  <strong style="color:${theme.ink};">PG Day Egypt 2026</strong> — Egypt's
                  first PostgreSQL community conference.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
                  <tr>
                    <td style="
                      padding:12px 16px;
                      background-color:${theme.surfaceRaised};
                      border-left:2px solid ${theme.blue};
                      font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
                      font-size:13px;
                      color:${theme.ink};
                      line-height:1.8;
                    ">
                      date&nbsp;&nbsp;: Saturday, October 10, 2026<br/>
                      city&nbsp;&nbsp;: Cairo, Egypt<br/>
                      status : <span style="color:${theme.amber};">pending — we'll confirm closer to the event</span>
                    </td>
                  </tr>
                </table>

                <p style="
                  margin:0 0 20px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  font-size:15px;
                  line-height:1.6;
                  color:${theme.muted};
                ">
                  We'll follow up closer to the event with confirmation details and
                  venue information as soon as they're finalized.
                </p>

                <p style="
                  margin:0 0 14px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  font-size:15px;
                  color:${theme.ink};
                  font-weight:600;
                ">In the meantime:</p>

                <div style="margin:0 0 12px;">
                  ${button(`${input.siteUrl}/schedule`, "View the schedule →", true)}
                  ${button(`${input.siteUrl}/speakers`, "Meet the speakers", false)}
                </div>

              </td>
            </tr>
          </table>

          <!-- Footer -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:20px 4px 0;text-align:center;">
                <p style="
                  margin:0 0 6px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  font-size:13px;
                  line-height:1.6;
                  color:${theme.muted};
                ">
                  See you there,<br/>
                  <strong style="color:${theme.ink};">The PG Day Egypt Team</strong>
                </p>
                <p style="
                  margin:12px 0 0;
                  font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
                  font-size:11px;
                  letter-spacing:0.04em;
                  color:${theme.muted};
                ">
                  PG Day Egypt 2026 · Cairo, Egypt · <a href="mailto:${siteConfig.organizer.contactEmail}" style="color:${theme.blue};text-decoration:none;">${siteConfig.organizer.contactEmail}</a>
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}
