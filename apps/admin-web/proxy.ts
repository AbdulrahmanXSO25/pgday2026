import { NextResponse, type NextRequest } from "next/server";

// UX-only guard — real auth is enforced by the API via pgegypt_session cookie.
// Middleware redirect is convenience, not security boundary.
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get("pgegypt_session");

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Authenticated user hitting /login → bounce to next or dashboard
  if (isPublic && session) {
    if (pathname === "/login" || pathname.startsWith("/login/")) {
      const next = request.nextUrl.searchParams.get("next");
      // Validate next is internal path to avoid open-redirect
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      const url = request.nextUrl.clone();
      url.pathname = target;
      url.searchParams.delete("next");
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (isPublic) {
    return NextResponse.next();
  }

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
