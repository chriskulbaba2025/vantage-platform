/**
 * WP11 Report Viewer Redirect — /audits/[auditId]/report
 *
 * Redirects to index.html within the approved report.
 */

import { workerClient } from "@/lib/worker-client";
import { notFound } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { auditId: string } },
) {
  const status = await workerClient.getAuditStatus(params.auditId);

  // Reviewer-readable states.  The Draft Review button is shown for
  // draft_rendered / in_review — the reviewer-facing report proxy
  // (report/[...path]/route.ts) serves those pages.  Gating on
  // approved/published only made the draft button 404.
  const READABLE_STATES = new Set(["draft_rendered", "in_review", "approved", "published"]);
  if (!status || !READABLE_STATES.has(status.state)) {
    notFound();
  }
  // Redirect using trusted origin (not request URL host header)
  return NextResponse.redirect(
    new URL(`/audits/${params.auditId}/report/index.html`, request.nextUrl.origin),
  );
}
