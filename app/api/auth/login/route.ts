/**
 * POST /api/auth/login — authenticate against the identity provider and
 * issue the httpOnly session cookie.
 *
 * The session token is HMAC-signed with the shared webhook secret; the
 * browser never receives the secret.  Invalid credentials return a
 * non-descriptive 401.
 */

import { NextRequest, NextResponse } from "next/server";
import { createIdentityProvider } from "@/lib/identity/identity-provider";
import { SESSION_COOKIE, signSession } from "@/lib/identity/session";

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 422 });
  }

  const provider = createIdentityProvider();
  const principal = await provider.authenticate(email, password);
  if (!principal) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, signSession(principal), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
