/**
 * Reviewer authorization for draft report routes.
 *
 * The portal has no per-user session system.  Its only existing
 * authorization primitive is the shared webhook secret that already
 * authorizes every worker admin operation.  Draft (draft_rendered /
 * in_review) reports are reviewer-only content (PRD §17.5: draft and
 * reviewed reports must not be exposed through client-facing routes).
 *
 * Model:
 *   - A holder of the webhook secret (the portal operator / server-side
 *     tooling) POSTs /api/reviewer-session with the x-vantage-secret
 *     header.  The route sets an httpOnly cookie containing an HMAC of a
 *     fixed marker under the secret.
 *   - Reviewer-facing routes accept drafts ONLY when the cookie HMAC
 *     verifies (constant-time compare).
 *   - approved/published states remain public (client-facing).
 *
 * The secret never reaches the browser; the cookie is a bounded bearer
 * credential (12h) in the same trust class as the existing secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const REVIEWER_COOKIE = "prysm_reviewer";
const MARKER = "prysm-reviewer-v1";

function tokenValue(): string {
  const secret = process.env.VANTAGE_WEBHOOK_SECRET || "";
  if (!secret) {
    throw new Error("VANTAGE_WEBHOOK_SECRET is not configured — reviewer sessions cannot be issued");
  }
  return createHmac("sha256", secret).update(MARKER).digest("hex");
}

/** Issue the reviewer token (server-side, secret-protected callers only). */
export function issueReviewerToken(): string {
  return tokenValue();
}

/** Verify a candidate cookie value in constant time. */
export function isValidReviewerToken(candidate: string | undefined | null): boolean {
  if (!candidate || typeof candidate !== "string") return false;
  const secret = process.env.VANTAGE_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(MARKER).digest();
  const received = Buffer.from(candidate, "hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/** Reviewer states that require the reviewer session. */
export const REVIEWER_ONLY_STATES = new Set(["draft_rendered", "in_review"]);

/** Public client-facing states (approved/published). */
export const PUBLIC_STATES = new Set(["approved", "published"]);
