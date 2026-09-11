// Email templates — pure functions, no I/O, PII-safe.
// PG-branded, professional, concise. No SQL jokes, no jargon.

const theme = {
  bg: "#EAF0F5",
  surface: "#FFFFFF",
  surfaceRaised: "#F3F6F9",
  hairline: "#D7DEE4",
  ink: "#2E3942",
  muted: "#5A6B7A",
  blue: "#336791",
  blueDark: "#27557A",
  amber: "#8A5A1E",
  green: "#2E7D4F",
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
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader)}</div>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(opts.title)}</title></head><body style="margin:0;padding:0;background-color:${theme.bg};"><div role="article" aria-roledescription="email" lang="en" style="background-color:${theme.bg};padding:32px 16px;">${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;"><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr><td style="padding:0 4px 12px;border-bottom:2px solid ${theme.blue};"><span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:${theme.ink};">PG&nbsp;Day&nbsp;Egypt</span><span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:${theme.blue};letter-spacing:0.08em;">&nbsp;·&nbsp;2026</span></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${theme.surface};border:1px solid ${theme.hairline};border-radius:6px;"><tr><td style="padding:32px;">${opts.body}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 4px 0;text-align:center;"><p style="margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:${theme.muted};">PG Day Egypt 2026 · Saturday, October 10 · Cairo, Egypt</p><p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${theme.muted};">You received this email because you signed up on the PG Day Egypt website.</p></td></tr></table></td></tr></table></div></body></html>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:${theme.blue};">${text}</h1>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${theme.muted};">${text}</p>`;
}

function detailTable(rows: Array<{ label: string; value: string }>): string {
  const cells = rows
    .map(
      (r) =>
        `<tr><td style="padding:8px 16px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:${theme.muted};white-space:nowrap;vertical-align:top;">${r.label}</td><td style="padding:8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${theme.ink};vertical-align:top;">${r.value}</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;"><tr><td style="padding:12px 16px;background-color:${theme.surfaceRaised};border-left:2px solid ${theme.blue};"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${cells}</table></td></tr></table>`;
}

function signoff(): string {
  return `<p style="margin:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${theme.ink};">See you there,<br/><strong style="color:${theme.blue};">The PG Day Egypt Team</strong></p>`;
}

// ---------------------------------------------------------------------------
// 1. Registration received — §18
// ---------------------------------------------------------------------------

export function buildRegistrationReceivedEmail(input: {
  name: string;
  siteUrl: string;
  eventDate?: string;
  city?: string;
}): { subject: string; html: string; text: string } {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeName = escapeHtml(input.name.trim());
  const eventDate = input.eventDate ?? "Saturday, October 10, 2026";
  const city = input.city ?? "Cairo, Egypt";
  const subject = "You're registered for PG Day Egypt 2026";
  const text = [
    `Hi ${input.name},`,
    "",
    `Thanks for registering for PG Day Egypt 2026 — Egypt's first PostgreSQL community conference, happening ${eventDate} in ${city}.`,
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
    ${heading(`Thanks for registering, ${firstName}!`)}
    ${paragraph(`We've received your registration for <strong style="color:${theme.ink};">PG Day Egypt 2026</strong> — Egypt's first PostgreSQL community conference.`)}
    ${detailTable([
      { label: "Date", value: escapeHtml(eventDate) },
      { label: "City", value: escapeHtml(city) },
      {
        label: "Status",
        value: `<span style="color:${theme.amber};">Pending — we'll confirm closer to the event</span>`,
      },
    ])}
    ${paragraph("We'll follow up closer to the event with confirmation details and venue information as soon as they're finalized.")}
    <div style="margin:0 0 12px;">${button(`${input.siteUrl}/schedule`, "View the schedule", true)}${button(`${input.siteUrl}/speakers`, "Meet the speakers", false)}</div>
    ${signoff()}
  `;

  return {
    subject,
    html: wrapHtml({ title: subject, preheader: `Thanks for registering, ${firstName}!`, body }),
    text,
  };
}

// ---------------------------------------------------------------------------
// 2. Registration acceptance (confirmed) — §18.4
// ---------------------------------------------------------------------------

export function buildRegistrationAcceptedEmail(input: {
  name: string;
  siteUrl: string;
  eventDate?: string;
  city?: string;
  checkinLink?: string;
}): { subject: string; html: string; text: string } {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeName = escapeHtml(input.name.trim());
  const eventDate = input.eventDate ?? "Saturday, October 10, 2026";
  const city = input.city ?? "Cairo, Egypt";
  const subject = "Registration confirmed — PG Day Egypt 2026";
  const text = [
    `Hi ${input.name},`,
    "",
    `Great news — your registration for PG Day Egypt 2026 is confirmed. We look forward to seeing you on ${eventDate} in ${city}.`,
    "",
    input.checkinLink ? `Check-in details: ${input.checkinLink}` : "",
    `Schedule: ${input.siteUrl}/schedule`,
    `Speakers: ${input.siteUrl}/speakers`,
    "",
    "See you there,",
    "The PG Day Egypt Team",
  ].join("\n");

  const checkinBlock = input.checkinLink
    ? `<div style="margin:0 0 12px;">${button(input.checkinLink, "View check-in details", true)}</div>`
    : "";

  const body = `
    ${heading(`You're confirmed, ${firstName}!`)}
    ${paragraph(`Your registration for <strong style="color:${theme.ink};">PG Day Egypt 2026</strong> is confirmed. We look forward to seeing you on <strong style="color:${theme.ink};">${escapeHtml(eventDate)}</strong> in <strong style="color:${theme.ink};">${escapeHtml(city)}</strong>.`)}
    ${detailTable([
      { label: "Date", value: escapeHtml(eventDate) },
      { label: "City", value: escapeHtml(city) },
      { label: "Status", value: `<span style="color:${theme.green};">Confirmed</span>` },
    ])}
    ${checkinBlock}
    <div style="margin:0 0 12px;">${button(`${input.siteUrl}/schedule`, "View the schedule", false)}${button(`${input.siteUrl}/speakers`, "Meet the speakers", false)}</div>
    ${signoff()}
  `;

  return {
    subject,
    html: wrapHtml({
      title: subject,
      preheader: `Your registration is confirmed, ${firstName}!`,
      body,
    }),
    text,
  };
}

// ---------------------------------------------------------------------------
// 3. Registration rejection (declined) — §18.4
// ---------------------------------------------------------------------------

export function buildRegistrationRejectedEmail(input: { name: string; siteUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeName = escapeHtml(input.name.trim());
  const subject = "Update on your registration — PG Day Egypt 2026";
  const text = [
    `Hi ${input.name},`,
    "",
    "Thank you for registering for PG Day Egypt 2026. Unfortunately, we're unable to confirm your registration at this time — the event has limited capacity and demand was very high.",
    "",
    "We'd love to see you at a future PG Day Egypt event. You can also follow the community for updates.",
    "",
    `Website: ${input.siteUrl}`,
    "",
    "Warm regards,",
    "The PG Day Egypt Team",
  ].join("\n");

  const body = `
    ${heading(`Thank you for registering, ${firstName}`)}
    ${paragraph('Thank you for registering for <strong style="color:${theme.ink};">PG Day Egypt 2026</strong>. Unfortunately, we\'re unable to confirm your registration at this time — the event has limited capacity and demand was very high.')}
    ${paragraph("We'd love to see you at a future PG Day Egypt event. You can also follow the PostgreSQL Egypt community for updates.")}
    <div style="margin:0 0 12px;">${button(input.siteUrl, "Visit the website", true)}</div>
    ${signoff()}
  `;

  return {
    subject,
    html: wrapHtml({ title: subject, preheader: "An update on your registration", body }),
    text,
  };
}

// ---------------------------------------------------------------------------
// 4. Registration waitlist (bonus, consistent with status flow) — §18.4
// ---------------------------------------------------------------------------

export function buildRegistrationWaitlistEmail(input: { name: string; siteUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeName = escapeHtml(input.name.trim());
  const subject = "You're on the waitlist — PG Day Egypt 2026";
  const text = [
    `Hi ${input.name},`,
    "",
    "You've been added to the waitlist for PG Day Egypt 2026. If a spot opens up, we'll let you know right away.",
    "",
    `Website: ${input.siteUrl}`,
    "",
    "Best regards,",
    "The PG Day Egypt Team",
  ].join("\n");

  const body = `
    ${heading(`You're on the waitlist, ${firstName}`)}
    ${paragraph("You've been added to the waitlist for <strong style=\"color:${theme.ink};\">PG Day Egypt 2026</strong>. If a spot opens up, we'll let you know right away.")}
    <div style="margin:0 0 12px;">${button(input.siteUrl, "Visit the website", true)}</div>
    ${signoff()}
  `;

  return {
    subject,
    html: wrapHtml({ title: subject, preheader: "You're on the waitlist", body }),
    text,
  };
}

// ---------------------------------------------------------------------------
// 5. CFP received — §19.1
// ---------------------------------------------------------------------------

export function buildCfpReceivedEmail(input: { name: string; title: string; siteUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeName = escapeHtml(input.name.trim());
  const safeTitle = escapeHtml(input.title);
  const subject = "We received your talk proposal — PG Day Egypt 2026";
  const text = [
    `Hi ${input.name},`,
    "",
    `Thanks for submitting "${input.title}" to PG Day Egypt 2026.`,
    "",
    "Our program committee will review it and get back to you at this address. You can check the status of your submission anytime on the website.",
    "",
    `Submission status: ${input.siteUrl}/cfp`,
    "",
    "Best regards,",
    "The PG Day Egypt Team",
  ].join("\n");

  const body = `
    ${heading(`Thanks for submitting, ${firstName}!`)}
    ${paragraph(`We've received your talk proposal <strong style="color:${theme.ink};">${safeTitle}</strong> for <strong style="color:${theme.ink};">PG Day Egypt 2026</strong>.`)}
    ${paragraph("Our program committee will review it and get back to you at this address. You can check the status of your submission anytime on the website.")}
    <div style="margin:0 0 12px;">${button(`${input.siteUrl}/cfp`, "Check submission status", true)}</div>
    ${signoff()}
  `;

  return {
    subject,
    html: wrapHtml({ title: subject, preheader: `We received "${input.title}"`, body }),
    text,
  };
}

// ---------------------------------------------------------------------------
// 6. CFP approval — with session details (§19.3 / §22.2)
// ---------------------------------------------------------------------------

export type CfpApprovalSession = {
  date?: string;
  time?: string;
  room?: string;
  track?: string;
  level?: string;
  duration?: string;
  talkType?: string;
};

export function buildCfpApprovalEmail(input: {
  name: string;
  title: string;
  siteUrl: string;
  session?: CfpApprovalSession;
}): { subject: string; html: string; text: string } {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeName = escapeHtml(input.name.trim());
  const safeTitle = escapeHtml(input.title);
  const session = input.session ?? {};
  const subject = "Your talk is confirmed — PG Day Egypt 2026";
  const text = [
    `Hi ${input.name},`,
    "",
    `Great news — your talk "${input.title}" is confirmed for PG Day Egypt 2026!`,
    "",
    session.date ? `Date: ${session.date}` : "",
    session.time ? `Time: ${session.time}` : "",
    session.room ? `Room: ${session.room}` : "",
    session.track ? `Track: ${session.track}` : "",
    session.level ? `Level: ${session.level}` : "",
    session.duration ? `Duration: ${session.duration}` : "",
    "",
    "We'll share speaker logistics and preparation details closer to the event.",
    "",
    `Schedule: ${input.siteUrl}/schedule`,
    "",
    "Congratulations again,",
    "The PG Day Egypt Team",
  ].join("\n");

  const detailRows: Array<{ label: string; value: string }> = [];
  if (session.date) detailRows.push({ label: "Date", value: escapeHtml(session.date) });
  if (session.time) detailRows.push({ label: "Time", value: escapeHtml(session.time) });
  if (session.room) detailRows.push({ label: "Room", value: escapeHtml(session.room) });
  if (session.track) detailRows.push({ label: "Track", value: escapeHtml(session.track) });
  if (session.level) detailRows.push({ label: "Level", value: escapeHtml(session.level) });
  if (session.duration) detailRows.push({ label: "Duration", value: escapeHtml(session.duration) });
  if (session.talkType) detailRows.push({ label: "Format", value: escapeHtml(session.talkType) });

  const detailsBlock = detailRows.length > 0 ? detailTable(detailRows) : "";

  const body = `
    ${heading(`You're in, ${firstName}!`)}
    ${paragraph(`Great news — your talk <strong style="color:${theme.ink};">${safeTitle}</strong> is confirmed for <strong style="color:${theme.ink};">PG Day Egypt 2026</strong>.`)}
    ${detailsBlock}
    ${paragraph("We'll share speaker logistics and preparation details closer to the event.")}
    <div style="margin:0 0 12px;">${button(`${input.siteUrl}/schedule`, "View the schedule", true)}</div>
    ${signoff()}
  `;

  return {
    subject,
    html: wrapHtml({ title: subject, preheader: `Your talk "${input.title}" is confirmed!`, body }),
    text,
  };
}

// ---------------------------------------------------------------------------
// 7. CFP rejected — §19.3
// ---------------------------------------------------------------------------

export function buildCfpRejectedEmail(input: {
  name: string;
  title: string;
  siteUrl: string;
  feedback?: string;
}): { subject: string; html: string; text: string } {
  const firstName = escapeHtml(input.name.trim().split(/\s+/)[0] || "there");
  const safeName = escapeHtml(input.name.trim());
  const safeTitle = escapeHtml(input.title);
  const safeFeedback = input.feedback ? escapeHtml(input.feedback) : "";
  const subject = "Update on your talk proposal — PG Day Egypt 2026";
  const text = [
    `Hi ${input.name},`,
    "",
    `Thank you for submitting "${input.title}" to PG Day Egypt 2026.`,
    "",
    "We received many strong proposals and unfortunately couldn't include all of them in this year's program. We'd love to see you submit again next year.",
    input.feedback ? `\nFeedback: ${input.feedback}\n` : "",
    `Website: ${input.siteUrl}`,
    "",
    "Warm regards,",
    "The PG Day Egypt Team",
  ].join("\n");

  const feedbackBlock = safeFeedback
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td style="padding:12px 16px;background-color:${theme.surfaceRaised};border-left:2px solid ${theme.amber};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:${theme.ink};line-height:1.6;">${safeFeedback}</td></tr></table>`
    : "";

  const body = `
    ${heading(`Thank you for submitting, ${firstName}`)}
    ${paragraph(`Thank you for submitting <strong style="color:${theme.ink};">${safeTitle}</strong> to <strong style="color:${theme.ink};">PG Day Egypt 2026</strong>.`)}
    ${paragraph("We received many strong proposals and unfortunately couldn't include all of them in this year's program. We'd love to see you submit again next year.")}
    ${feedbackBlock}
    <div style="margin:0 0 12px;">${button(input.siteUrl, "Visit the website", true)}</div>
    ${signoff()}
  `;

  return {
    subject,
    html: wrapHtml({ title: subject, preheader: "An update on your talk proposal", body }),
    text,
  };
}

// ---------------------------------------------------------------------------
// Generic CFP status — under_review / needs_revision (kept for those states)
// ---------------------------------------------------------------------------

export type CfpStatus = "submitted" | "under_review" | "accepted" | "rejected" | "needs_revision";

const cfpSubjects: Record<CfpStatus, string> = {
  submitted: "We received your talk proposal — PG Day Egypt 2026",
  under_review: "Your talk is under review — PG Day Egypt 2026",
  accepted: "Your talk was accepted — PG Day Egypt 2026",
  rejected: "Update on your talk proposal — PG Day Egypt 2026",
  needs_revision: "Action needed: your talk proposal — PG Day Egypt 2026",
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
    ${heading(`${headline}, ${firstName}!`)}
    ${paragraph(detailMap[input.status])}
    ${feedbackBlock}
    <div style="margin:16px 0 0;">${button(`${input.siteUrl}/cfp`, "View submission", true)}</div>
  `;

  return { subject, html: wrapHtml({ title: subject, body }), text };
}

// ---------------------------------------------------------------------------
// Deprecated aliases — kept for backwards compatibility (tests / callers)
// ---------------------------------------------------------------------------

/** @deprecated Use buildRegistrationReceivedEmail */
export function buildThankYouEmail(input: { name: string; siteUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  return buildRegistrationReceivedEmail(input);
}
