/**
 * Web session — authenticated principal carried in an httpOnly cookie.
 *
 * The session token is HMAC-signed with the shared webhook secret (the
 * same credential that governs all worker admin calls).  The cookie holds
 * { sub, email, displayName, exp } — the secret never reaches the browser.
 *
 * The worker verifies the same principal via the x-prysm-principal header
 * signed with the shared secret (lib/identity/principal.ts re-signs per
 * request); membership and tenant resolution happen ONLY server-side at
 * the worker against the Prysm database.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "prysm_session";
export const SESSION_MAX_AGE_S = 12 * 60 * 60;

export interface SessionPrincipal {
  sub: string;
  email: string;
  displayName: string;
  iat: number;
  exp: number;
}

function secret(): string {
  return process.env.VANTAGE_WEBHOOK_SECRET || "";
}

function hmacOf(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function signSession(principal: { sub: string; email: string; displayName?: string }, nowSec = Math.floor(Date.now() / 1000)): string {
  const body: SessionPrincipal = {
    sub: principal.sub,
    email: principal.email || "",
    displayName: principal.displayName || "",
    iat: nowSec,
    exp: nowSec + SESSION_MAX_AGE_S,
  };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return `${encoded}.${hmacOf(encoded)}`;
}

export function verifySession(token: string | undefined, nowSec = Math.floor(Date.now() / 1000)): SessionPrincipal | null {
  if (!token || typeof token !== "string") return null;
  if (!secret()) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = Buffer.from(hmacOf(body), "hex");
  const received = Buffer.from(signature, "hex");
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  let principal: SessionPrincipal;
  try {
    principal = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof principal?.sub !== "string" || principal.sub.length === 0) return null;
  if (typeof principal.exp !== "number" || principal.exp < nowSec) return null;
  return principal;
}

/** Read the current authenticated principal from the request cookies
 * (server components / route handlers). */
export function currentPrincipal(): SessionPrincipal | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySession(token);
}
