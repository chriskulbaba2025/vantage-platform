/**
 * Reviewer session issuance.
 *
 * POST /api/reviewer-session
 * Requires the x-vantage-secret header to match the configured webhook
 * secret (the same credential that authorizes all worker admin calls).
 * On success, sets the httpOnly reviewer cookie that unlocks the
 * reviewer-facing draft report routes for this browser.
 *
 * The secret never reaches the browser — this endpoint is intended for
 * the portal operator or server-side tooling (curl, n8n).
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { REVIEWER_COOKIE, issueReviewerToken } from "@/lib/reviewer-auth";

export async function POST(request: NextRequest) {
  const secret = process.env.VANTAGE_WEBHOOK_SECRET || "";
  const provided = request.headers.get("x-vantage-secret") || "";

  const expected = Buffer.from(secret, "utf8");
  const received = Buffer.from(provided, "utf8");
  const ok =
    secret.length > 0 &&
    provided.length === secret.length &&
    timingSafeEqual(received, expected);

  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = issueReviewerToken();
  const response = NextResponse.json({ ok: true, expiresInHours: 12 });
  response.cookies.set(REVIEWER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
