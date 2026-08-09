/**
 * WP11 Report Page Proxy — /audits/[auditId]/report/[...path]
 *
 * Proxies report page requests to the Railway worker.
 * Only serves pages when lifecycle state is APPROVED or PUBLISHED.
 * This is a same-origin Route Handler — credentials stay server-side.
 */

import { workerClient } from "@/lib/worker-client";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { auditId: string; path: string[] } },
) {
  const { auditId, path } = params;
  const filename = path.join("/");

  // Path traversal guard
  if (filename.includes("..") || filename.includes("//") || filename.includes("\\")) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  // Only allow HTML and JSON files
  if (!/^[a-z0-9_-]+\.(html|json)$/i.test(filename)) {
    return new NextResponse("Invalid file type", { status: 400 });
  }

  try {
    // Get slug and clientId from query params or derive from audit
    const searchParams = request.nextUrl.searchParams;
    const slug = searchParams.get("slug") || "";
    const clientId = searchParams.get("clientId") || "";

    const result = await workerClient.getReportPage(auditId, filename, slug, clientId);

    if (result.status === 403) {
      return NextResponse.json({ error: "Report not available", code: "REPORT_NOT_APPROVED" }, { status: 403 });
    }
    if (result.status === 404 || !result.body) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const contentType = filename.endsWith(".html") ? "text/html; charset=utf-8" : "application/json";
    return new NextResponse(result.body, {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to load report page" }, { status: 500 });
  }
}
