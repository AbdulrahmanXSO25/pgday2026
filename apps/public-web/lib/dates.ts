/**
 * Date & time formatting helpers for the public site.
 * Schedule times are "HH:MM" strings on the event day (single-day event).
 */

/** "09:00" + "09:30" → "09:00 – 09:30" (en dash, tabular for alignment). */
export function formatTimeRange(start: string | undefined, end: string | undefined): string {
  if (!start && !end) return "";
  if (!end) return start ?? "";
  return `${start ?? ""} – ${end}`;
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
