/**
 * Report Viewer Redirect — /audits/[auditId]/report
 *
 * Client-facing (public) states: approved / published — redirect to
 * index.html within the report.
 *
 * Reviewer-only states: draft_rendered / in_review — require the
 * reviewer session cookie (minted via POST /api/reviewer-session by a
 * holder of the webhook secret).  Anonymous requests for draft reports
 * fail closed (notFound) without leaking the audit's existence.
 */

import { workerClient } from "@/lib/worker-client";
import { notFound } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import {
  REVIEWER_COOKIE,
  isValidReviewerToken,
  REVIEWER_ONLY_STATES,
  PUBLIC_STATES,
} from "@/lib/reviewer-auth";
import { principalFromCookies } from "@/lib/identity/principal";
import { SESSION_COOKIE } from "@/lib/identity/session";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { auditId: string } },
) {
  // MT-IDENTITY: bind the authenticated principal — the WORKER enforces
  // tenant membership server-side.  Without a portal session, only the
  // governed reviewer session (minted by a webhook-secret holder) may pass
  // the internal boundary; plain anonymous traffic fails closed here.
  const principal = principalFromCookies(request.cookies.get(SESSION_COOKIE)?.value);
  const reviewerToken = request.cookies.get(REVIEWER_COOKIE)?.value;
  const internalAllowed = isValidReviewerToken(reviewerToken);
  if (!principal && !internalAllowed) {
    notFound();
  }
  const client = principal ? workerClient.as(principal) : workerClient;

  const status = await client.getAuditStatus(params.auditId);
  if (!status) {
    notFound();
  }

  const state = String(status.state || "");

  if (PUBLIC_STATES.has(state)) {
    return NextResponse.redirect(
      new URL(`/audits/${params.auditId}/report/index.html`, request.nextUrl.origin),
    );
  }

  if (REVIEWER_ONLY_STATES.has(state)) {
    if (!principal && !internalAllowed) {
      notFound();
    }
    return NextResponse.redirect(
      new URL(`/audits/${params.auditId}/report/index.html`, request.nextUrl.origin),
    );
  }

  notFound();
}
