/**
 * Portal middleware — UX gate for authenticated areas.
 *
 * This is a navigation convenience, NOT the security boundary.  Every
 * protected server component and route handler independently verifies the
 * session server-side, and the worker re-verifies the signed principal
 * against the Prysm database.  UI hiding is never authorization.
 */

import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/audits", "/api/audits", "/admin", "/api/admin"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!isProtected) return NextResponse.next();

  const session = request.cookies.get("prysm_session")?.value;
  if (!session) {
    const login = new URL("/login", request.nextUrl.origin);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/audits/:path*", "/api/audits/:path*"],
};
