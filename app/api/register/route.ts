import { NextResponse } from "next/server";
import { RegistrationSchema } from "@/lib/schema";
import { findRegistrationByEmail, getDB, insertRegistration } from "@/lib/d1";
import { sendRegistrationThankYouEmail } from "@/lib/resend";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function getClientIp(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

async function isRateLimited(db: D1Database, ip: string, now: number): Promise<boolean> {
  const nowIso = new Date(now).toISOString();
  const windowStartIso = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO rate_limits (key, window_start, count)
         VALUES (?1, ?2, 1)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE
             WHEN rate_limits.window_start > ?3 THEN rate_limits.count + 1
             ELSE 1
           END,
           window_start = CASE
             WHEN rate_limits.window_start > ?3 THEN rate_limits.window_start
             ELSE ?2
           END`
      )
      .bind(ip, nowIso, windowStartIso)
      .run();

    const row = await db
      .prepare("SELECT count FROM rate_limits WHERE key = ?1")
      .bind(ip)
      .first<{ count: number }>();

    return (row?.count ?? 0) > RATE_LIMIT_MAX;
  } catch (err) {
    console.error("[register] rate limit check failed (failing open):", err);
    return false;
  }
}

export async function POST(request: Request) {
  const db = getDB();

  const ip = getClientIp(request);
  const now = Date.now();

  if (await isRateLimited(db, ip, now)) {
    return NextResponse.json(
      { success: false, message: "Too many registration attempts. Please try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  const parsed = RegistrationSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { success: false, message: "Please fix the highlighted fields.", fieldErrors },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const email = data.email.trim().toLowerCase();

  try {
    const existing = await findRegistrationByEmail(db, email);
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          message: `Looks like ${email} is already registered. You're all set — we'll be in touch closer to the event.`,
        },
        { status: 409 }
      );
    }
  } catch (err) {
    console.error("[register] failed to check duplicate email:", err);
    return NextResponse.json(
      {
        success: false,
        message: "Something went wrong. Please try again in a moment.",
      },
      { status: 500 }
    );
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await insertRegistration(db, {
      id,
      name: data.name.trim(),
      email,
      organization: data.organization,
      role: data.role,
      dietaryNotes: data.dietaryNotes,
      status: "pending",
      createdAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint failed")) {
      return NextResponse.json(
        {
          success: false,
          message: `Looks like ${email} is already registered. You're all set — we'll be in touch closer to the event.`,
        },
        { status: 409 }
      );
    }
    console.error("[register] failed to insert registration:", err);
    return NextResponse.json(
      {
        success: false,
        message: "Something went wrong. Please try again in a moment.",
      },
      { status: 500 }
    );
  }

  const emailResult = await sendRegistrationThankYouEmail({
    name: data.name.trim(),
    email,
  });
  if (!emailResult.ok) {
    console.error("[register] thank-you email failed (non-fatal):", emailResult.error);
  }

  return NextResponse.json({ success: true });
}
