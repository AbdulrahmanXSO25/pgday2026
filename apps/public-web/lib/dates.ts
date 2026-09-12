/**
 * Date & time formatting helpers for the public site.
 * Schedule times are "HH:MM" strings on the event day (single-day event).
 */

/** "HH:MM" passthrough; ISO timestamp → "HH:MM" in Africa/Cairo. */
function formatTime(value: string | undefined): string {
  if (!value) return "";
  // ISO timestamp (from published snapshots) → Cairo local time
  if (value.includes("T")) {
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Cairo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return fmt.format(d);
    } catch {
      return value;
    }
  }
  // Already "HH:MM" (seed content) — display as-is
  return value;
}

/** "09:00" + "09:30" → "09:00 – 09:30" (en dash, tabular for alignment). */
export function formatTimeRange(start: string | undefined, end: string | undefined): string {
  const s = formatTime(start);
  const e = formatTime(end);
  if (!s && !e) return "";
  if (!e) return s;
  return `${s} – ${e}`;
}

/** "Africa/Cairo" → "Cairo time". Falls back to the raw value. */
export function formatTimezone(timezone: string | undefined): string {
  if (!timezone) return "local time";
  const city = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  return `${city} time`;
}

/** "2026-10-10" → "October 10, 2026" (used when dateDisplay is missing). */
export function formatDateFallback(date: string | undefined): string {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
