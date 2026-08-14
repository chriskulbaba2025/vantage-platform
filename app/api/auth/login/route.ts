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

// Minimal in-memory login throttle — counts FAILED attempts per
// (ip, email) in a sliding window.  Per-process state (resets on Vercel
// cold starts); Cognito adaptive throttling is the durable backstop.
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map<string, number[]>();

function recordLoginFailure(key: string, nowMs = Date.now()): number {
  const entries = loginFailures.get(key) || [];
  const cutoff = nowMs - LOGIN_WINDOW_MS;
  while (entries.length > 0 && entries[0] <= cutoff) entries.shift();
  entries.push(nowMs);
  loginFailures.set(key, entries);
  if (loginFailures.size > 5000) {
    for (const [k, v] of loginFailures) if (v.length === 0) loginFailures.delete(k);
  }
  return entries.length;
}

function loginThrottled(key: string, nowMs = Date.now()): boolean {
  const entries = loginFailures.get(key) || [];
  const cutoff = nowMs - LOGIN_WINDOW_MS;
  while (entries.length > 0 && entries[0] <= cutoff) entries.shift();
  return entries.length >= LOGIN_MAX_FAILURES;
}

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
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || "unknown";
  const attemptKey = `${ip}|${email.toLowerCase()}`;
  if (loginThrottled(attemptKey)) {
    return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
  }

  const principal = await provider.authenticate(email, password);
  if (!principal) {
    recordLoginFailure(attemptKey);
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
