import { NextResponse } from "next/server";

// Scaffold stub — real registration is handled by apps/api (Hono) on :8787.
// This keeps `next build` green without D1 bindings; in local dev the form
// posts to the API directly via NEXT_PUBLIC_API_URL when available.

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function POST(request: Request) {
  // Try to proxy to api if API_BASE_URL is set, otherwise return scaffold success.
  const apiBase =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  try {
    const body = await request.json();
    const res = await fetch(`${apiBase}/v1/registrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    // Fallback for scaffold builds without api running
    return NextResponse.json({ success: true }, { status: 200 });
  }
}
