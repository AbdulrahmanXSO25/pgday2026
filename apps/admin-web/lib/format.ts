/**
 * Human-readable labels for admin display values.
 * The API uses lowercase/snake_case status and module codes — organizers
 * should see plain words instead.
 */

/** "under_review" → "Under review", "checked_in" → "Checked in", "already_checked_in" → "Already checked in" */
export function humanizeStatus(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .split("_")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** "SUPER_ADMIN" → "Super admin", "ADMIN" → "Admin" */
export function roleLabel(role: string | null | undefined): string {
  if (role === "SUPER_ADMIN") return "Super admin";
  if (role === "ADMIN") return "Admin";
  return humanizeStatus(role);
}

/** "auth.login" → "Signed in", "registration.status_changed" → "Registration status changed" */
export function humanizeAction(action: string | null | undefined): string {
  if (!action) return "—";
  const known: Record<string, string> = {
    "auth.login": "Signed in",
    "auth.logout": "Signed out",
  };
  if (known[action]) return known[action];
  return action
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.toUpperCase() === "CFP" ? "CFP" : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

const ENTITY_LABELS: Record<string, string> = {
  registration: "Registration",
  user: "Team member",
  users: "Team member",
  speaker: "Speaker",
  speakers: "Speaker",
  session: "Session",
  sessions: "Session",
  cfp: "Proposal",
  cfp_submission: "Proposal",
  publication: "Publication",
  publications: "Publication",
  event: "Event settings",
  events: "Event settings",
  settings: "Event settings",
  media: "Media file",
  sponsor: "Sponsor",
  sponsors: "Sponsor",
  room: "Room",
  audit: "Audit log",
};

/** "cfp_submission" → "Proposal", "registration" → "Registration" */
export function entityLabel(entity: string | null | undefined): string {
  if (!entity) return "—";
  const key = entity.toLowerCase();
  return ENTITY_LABELS[key] ?? humanizeStatus(entity);
}

const MODULE_LABELS: Record<string, string> = {
  speakers: "Speakers",
  sessions: "Sessions",
  schedule: "Schedule",
  sponsors: "Sponsors",
  registrations: "Registrations",
  cfp: "Call for papers",
  checkin: "Check-in",
  media: "Media files",
  publishing: "Website & publishing",
  pages: "Website & publishing",
  users: "Team members",
  events: "Event settings",
  audit: "Audit log",
};

/** "publishing" → "Website & publishing", unknown codes fall back to humanized text */
export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? humanizeStatus(module);
}

/** Unix seconds → "10 Oct 2026, 14:30" in the visitor's locale */
export function formatDateTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined || !Number.isFinite(epochSeconds))
    return "—";
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "12 Oct 2026, 14:30" style for full timestamps */
export function formatDate(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined || !Number.isFinite(epochSeconds))
    return "—";
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
