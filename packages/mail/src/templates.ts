// Email templates — pure functions, no I/O, PII-safe.

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

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function button(href: string, label: string, primary: boolean): string {
  return `<a href="${href}" style="display:inline-block;padding:10px 22px;border:1px solid ${primary ? theme.blue : theme.hairline};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;margin:0 6px 8px 0;${primary ? `background-color:${theme.blue};color:#FFFFFF;` : `background-color:${theme.surface};color:${theme.blue};`}" >${label}</a>`;
}

function wrapHtml(opts: { title: string; preheader?: string; body: string }): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(opts.title)}</title></head><body style="margin:0;padding:0;background-color:${theme.bg};"><div role="article" aria-roledescription="email" lang="en" style="background-color:${theme.bg};padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;"><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr><td style="padding:0 4px 12px;border-bottom:2px solid ${theme.blue};"><span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:${theme.ink};">PG&nbsp;Day&nbsp;Egypt</span><span style="font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:${theme.blue};letter-spacing:0.08em;">2026</span></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${theme.surface};border:1px solid ${theme.hairline};"><tr><td style="padding:32px;">${opts.body}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 4px 0;text-align:center;"><p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:${theme.muted};">PG Day Egypt 2026 · Cairo, Egypt</p></td></tr></table></td></tr></table></div></body></html>`;
}

// ---------------------------------------------------------------------------
// Thank-you (registration) — §25
// ---------------------------------------------------------------------------

export function buildThankYouEmail(input: { name: string; siteUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeName = escapeHtml(input.name.trim());
  const subject = "You're registered for PG Day Egypt 2026 🎉";
  const text = [
    `Hi ${input.name},`,
    "",
    `Thanks for registering for PG Day Egypt 2026 — Egypt's first PostgreSQL community conference, happening Saturday, October 10, 2026 in Cairo.`,
    "",
    "We've received your registration. We'll follow up closer to the event with confirmation details and venue information as soon as they're finalized.",
    "",
    `Schedule: ${input.siteUrl}/schedule`,
    `Speakers: ${input.siteUrl}/speakers`,
    "",
    "See you there,",
    "The PG Day Egypt Team",
  ].join("\n");

  const body = `
    <p style="margin:0 0 16px;font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;font-size:12px;letter-spacing:0.04em;color:${theme.blue};">$ SELECT * FROM attendees WHERE email = '${safeName}';</p>
    <h1 style="margin:0 0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:${theme.blue};">Thanks for registering, ${firstName}!</h1>
    <p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${theme.muted};">We've received your registration for <strong style="color:${theme.ink};">PG Day Egypt 2026</strong> — Egypt's first PostgreSQL community conference.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td style="padding:12px 16px;background-color:${theme.surfaceRaised};border-left:2px solid ${theme.blue};font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:${theme.ink};line-height:1.8;">date&nbsp;&nbsp;: Saturday, October 10, 2026<br/>city&nbsp;&nbsp;: Cairo, Egypt<br/>status : <span style="color:${theme.amber};">pending — we'll confirm closer to the event</span></td></tr></table>
    <p style="margin:0 0 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${theme.muted};">We'll follow up closer to the event with confirmation details and venue information as soon as they're finalized.</p>
    <div style="margin:0 0 12px;">${button(`${input.siteUrl}/schedule`, "View the schedule →", true)}${button(`${input.siteUrl}/speakers`, "Meet the speakers", false)}</div>
  `;

  return { subject, html: wrapHtml({ title: subject, body }), text };
}

// ---------------------------------------------------------------------------
// CFP status — §19-21
// ---------------------------------------------------------------------------

export type CfpStatus = "submitted" | "under_review" | "accepted" | "rejected" | "needs_revision";

const cfpSubjects: Record<CfpStatus, string> = {
  submitted: "We received your CFP submission — PG Day Egypt 2026",
  under_review: "Your talk is under review — PG Day Egypt 2026",
  accepted: "Your talk was accepted! — PG Day Egypt 2026 🎉",
  rejected: "Update on your CFP submission — PG Day Egypt 2026",
  needs_revision: "Action needed: your CFP submission — PG Day Egypt 2026",
};

const cfpHeadlines: Record<CfpStatus, string> = {
  submitted: "Thanks for submitting!",
  under_review: "Under review",
  accepted: "You're in — talk accepted!",
  rejected: "Thank you for submitting",
  needs_revision: "Revision requested",
};

export function buildCfpStatusEmail(input: {
  name: string;
  title: string;
  status: CfpStatus;
  siteUrl: string;
  feedback?: string;
}): { subject: string; html: string; text: string } {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeTitle = escapeHtml(input.title);
  const safeFeedback = input.feedback ? escapeHtml(input.feedback) : "";
  const subject = cfpSubjects[input.status];
  const headline = cfpHeadlines[input.status];

  const detailMap: Record<CfpStatus, string> = {
    submitted: `We've received your talk <strong style="color:${theme.ink};">${safeTitle}</strong> and will review it shortly.`,
    under_review: `Your talk <strong style="color:${theme.ink};">${safeTitle}</strong> is now under review by our program committee.`,
    accepted: `Great news — your talk <strong style="color:${theme.ink};">${safeTitle}</strong> was accepted for PG Day Egypt 2026! We'll follow up with scheduling details.`,
    rejected: `Thank you for submitting <strong style="color:${theme.ink};">${safeTitle}</strong>. We had many strong submissions and couldn't accept all. We hope to see you at the event.`,
    needs_revision: `We reviewed <strong style="color:${theme.ink};">${safeTitle}</strong> and would like a revision before final decision.`,
  };

  const textMap: Record<CfpStatus, string> = {
    submitted: `We received your talk "${input.title}" and will review it shortly.`,
    under_review: `Your talk "${input.title}" is now under review.`,
    accepted: `Your talk "${input.title}" was accepted! We'll follow up with scheduling details.`,
    rejected: `Thank you for submitting "${input.title}". We couldn't accept all submissions.`,
    needs_revision: `We'd like a revision for "${input.title}".`,
  };

  const text = [
    `Hi ${input.name},`,
    "",
    textMap[input.status],
    input.feedback ? `\nFeedback: ${input.feedback}\n` : "",
    `Site: ${input.siteUrl}/cfp`,
    "",
    "— PG Day Egypt Team",
  ].join("\n");

  const feedbackBlock = safeFeedback
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 16px;"><tr><td style="padding:12px 16px;background-color:${theme.surfaceRaised};border-left:2px solid ${theme.amber};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${theme.ink};line-height:1.6;">${safeFeedback}</td></tr></table>`
    : "";

  const body = `
    <h1 style="margin:0 0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:${theme.blue};">${headline}, ${firstName}!</h1>
    <p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${theme.muted};">${detailMap[input.status]}</p>
    ${feedbackBlock}
    <div style="margin:16px 0 0;">${button(`${input.siteUrl}/cfp`, "View submission", true)}</div>
  `;

  return { subject, html: wrapHtml({ title: subject, body }), text };
}
