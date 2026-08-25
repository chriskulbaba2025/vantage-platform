/**
 * Approved report page proxy.
 *
 * Resolves slug/client identity from the governed audit status so the browser
 * never needs to carry internal artifact coordinates.
 */

import { workerClient } from "@/lib/worker-client";
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
    // MT-IDENTITY: bind the authenticated principal — the WORKER enforces
    // the tenant boundary and report role gate BEFORE artifact retrieval.
    // The secret-only internal boundary is reachable only via the governed
    // reviewer session (minted by a holder of the webhook secret), never
    // for plain anonymous browser traffic.
    const principal = principalFromCookies(request.cookies.get(SESSION_COOKIE)?.value);
    const reviewerToken = request.cookies.get(REVIEWER_COOKIE)?.value;
    const internalAllowed = isValidReviewerToken(reviewerToken);
    if (!principal && !internalAllowed) {
      return NextResponse.json({ error: "Authentication required", code: "UNAUTHENTICATED" }, { status: 401 });
    }
    const client = principal ? workerClient.as(principal) : workerClient;
    const status = await client.getAuditStatus(auditId);
    if (!status) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }
    const state = String(status.state || "");
    if (!PUBLIC_STATES.has(state) && !REVIEWER_ONLY_STATES.has(state)) {
      return NextResponse.json({ error: "Report not available", code: "REPORT_NOT_APPROVED" }, { status: 403 });
    }
    // Reviewer-only states: the WORKER enforces the membership role gate
    // for principal flows; the reviewer cookie governs only the internal
    // (non-portal) reviewer path.
    if (REVIEWER_ONLY_STATES.has(state) && !principal) {
      if (!internalAllowed) {
        return NextResponse.json({ error: "Reviewer authorization required", code: "REVIEWER_AUTH_REQUIRED" }, { status: 403 });
      }
    }

    const slug = String(status.slug || "");
    const clientId = String(status.clientId || "");
    if (!slug || !clientId) {
      return NextResponse.json({ error: "Approved report identity is incomplete" }, { status: 500 });
    }

    const result = await client.getReportPage(auditId, filename, slug, clientId);
    if (result.status === 403) {
      return NextResponse.json({ error: "Report not available", code: "REPORT_NOT_APPROVED" }, { status: 403 });
    }
    if (result.status === 404 || !result.body) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const contentType = result.contentType || (filename.endsWith(".html") ? "text/html; charset=utf-8" : "application/json");

    const body =
      REVIEWER_ONLY_STATES.has(state) && filename === "index.html"
        ? result.body.toString("utf8").replace(
            /<body([^>]*)>/i,
            `<body$1><div style="max-width:1200px;margin:16px auto 0;padding:0 24px;"><a href="/" style="display:inline-block;text-decoration:none;font-weight:600;">← Back to Dashboard</a></div>`,
          )
        : result.body;

    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Approved report proxy failed:", error);
    return NextResponse.json({ error: "Failed to load report page" }, { status: 500 });
  }
}
