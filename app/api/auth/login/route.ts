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
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/identity/session";

// Minimal in-memory login throttle — counts FAILED attempts per
// (ip, email) in a sliding window.  Per-process state (resets on Vercel
// cold starts); Cognito adaptive throttling is the durable backstop.
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map<string, number[]>();

/** Short-lived signed cookie carrying the Cognito NEW_PASSWORD_REQUIRED
 * session between the two login steps. */
const PENDING_COOKIE = "prysm_pending_pw";

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
  let body: { email?: string; password?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const newPassword = String(body.newPassword || "");

  const provider = createIdentityProvider();
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || "unknown";
  const attemptKey = `${ip}|${email.toLowerCase()}`;

  // ── Invite flow, step 2: user establishes their own password ─────────
  if (newPassword) {
    if (!email || newPassword.length < 8) {
      return NextResponse.json({ error: "Email and a new password (min 8 characters) are required" }, { status: 422 });
    }
    const pendingToken = request.cookies.get(PENDING_COOKIE)?.value;
    const pending = verifySession(pendingToken);
    if (!pending || pending.sub !== "pending-new-password" || pending.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: "New-password session expired — sign in again" }, { status: 401 });
    }
    if (loginThrottled(attemptKey)) {
      return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
    }
    const completed = await provider.completeNewPassword(email, newPassword, pending.displayName);
    if (completed.status !== "authenticated") {
      recordLoginFailure(attemptKey);
      return NextResponse.json({ error: "Could not set the new password — it may not meet the password policy" }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, signSession({ sub: completed.sub, email: completed.email, displayName: completed.displayName }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    response.cookies.set(PENDING_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }

  // ── Normal sign-in (also the invite flow's first step) ───────────────
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 422 });
  }
  if (loginThrottled(attemptKey)) {
    return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
  }

  const result = await provider.authenticate(email, password);
  if (result.status === "challenge") {
    // Cognito accepted the temporary password; the user must now choose
    // their own.  The Cognito challenge session rides in a short-lived
    // signed httpOnly cookie — never exposed to the browser's JS.
    const pendingToken = signSession({ sub: "pending-new-password", email, displayName: result.cognitoSession });
    const response = NextResponse.json({ challenge: "NEW_PASSWORD_REQUIRED", email });
    response.cookies.set(PENDING_COOKIE, pendingToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  }
  if (result.status !== "authenticated") {
    recordLoginFailure(attemptKey);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, signSession({ sub: result.sub, email: result.email, displayName: result.displayName }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
