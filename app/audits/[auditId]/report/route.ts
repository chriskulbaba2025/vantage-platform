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
  if (!status || (status.state !== "approved" && status.state !== "published")) {
    notFound();
  }
  // Redirect using trusted origin (not request URL host header)
  return NextResponse.redirect(
    new URL(`/audits/${params.auditId}/report/index.html`, request.nextUrl.origin),
  );
}
