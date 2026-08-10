/**
 * Approved report page proxy.
 *
 * Resolves slug/client identity from the governed audit status so the browser
 * never needs to carry internal artifact coordinates.
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

  if (filename.includes("..") || filename.includes("//") || filename.includes("\\")) {
    return new NextResponse("Invalid path", { status: 400 });
  }
  if (!/^[a-z0-9_-]+\.(html|json)$/i.test(filename)) {
    return new NextResponse("Invalid file type", { status: 400 });
  }

  try {
    const status = await workerClient.getAuditStatus(auditId);
    if (!status) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }
    if (status.state !== "approved" && status.state !== "published") {
      return NextResponse.json({ error: "Report not available", code: "REPORT_NOT_APPROVED" }, { status: 403 });
    }

    const slug = String(status.slug || "");
    const clientId = String(status.clientId || "");
    if (!slug || !clientId) {
      return NextResponse.json({ error: "Approved report identity is incomplete" }, { status: 500 });
    }

    const result = await workerClient.getReportPage(auditId, filename, slug, clientId);
    if (result.status === 403) {
      return NextResponse.json({ error: "Report not available", code: "REPORT_NOT_APPROVED" }, { status: 403 });
    }
    if (result.status === 404 || !result.body) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const contentType = result.contentType || (filename.endsWith(".html") ? "text/html; charset=utf-8" : "application/json");
    return new NextResponse(result.body, {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Approved report proxy failed:", error);
    return NextResponse.json({ error: "Failed to load report page" }, { status: 500 });
  }
}
