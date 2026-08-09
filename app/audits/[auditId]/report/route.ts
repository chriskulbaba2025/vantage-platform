/**
 * WP11 Report Viewer Redirect — /audits/[auditId]/report
 *
 * Redirects to index.html within the approved report.
 */

import { workerClient } from "@/lib/worker-client";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { auditId: string } },
) {
  const status = await workerClient.getAuditStatus(params.auditId);
  if (!status || (status.state !== "approved" && status.state !== "published")) {
    notFound();
  }
  // Redirect to index page
  return Response.redirect(
    new URL(`/audits/${params.auditId}/report/index.html`, _request.url),
  );
}
