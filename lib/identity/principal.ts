/**
 * Principal signing — the web's half of the governed internal identity
 * boundary.  Produces the x-prysm-principal bearer token verified by the
 * worker (services/worker/src/identity/authorization.js) with the shared
 * webhook secret.  Format must stay in lockstep with the worker.
 */

import { createHmac } from "node:crypto";
import { SESSION_COOKIE, verifySession } from "./session";

const PRINCIPAL_MAX_AGE_S = 60;

export interface Principal {
  sub: string;
  email: string;
  displayName: string;
}

export function signPrincipal(principal: Principal, nowMs = Date.now()): string {
  const secret = process.env.VANTAGE_WEBHOOK_SECRET || "";
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = {
    sub: principal.sub,
    email: principal.email || "",
    displayName: principal.displayName || "",
    iat: issuedAt,
    exp: issuedAt + PRINCIPAL_MAX_AGE_S,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${signature}`;
}

/**
 * Server-side helper: resolve the authenticated principal for the current
 * request and sign the internal principal header for worker calls.
 * Returns null when no valid session exists.
 */
export function principalFromCookies(cookieValue: string | undefined): Principal | null {
  const session = verifySession(cookieValue);
  if (!session) return null;
  return { sub: session.sub, email: session.email, displayName: session.displayName };
}

export { SESSION_COOKIE };
