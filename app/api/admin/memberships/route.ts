/**
 * ACCT-PROVISION — list memberships for a company (query: tenantId).
 * The WORKER enforces platform_admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { workerClient } from "@/lib/worker-client";
import { principalFromCookies } from "@/lib/identity/principal";
import { SESSION_COOKIE } from "@/lib/identity/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const principal = principalFromCookies(request.cookies.get(SESSION_COOKIE)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const tenantId = String(request.nextUrl.searchParams.get("tenantId") || "").trim();
  if (!tenantId) {
    return NextResponse.json({ error: "Company is required" }, { status: 422 });
  }
  try {
    const rows = await workerClient.as(principal).adminListMemberships(tenantId);
    return NextResponse.json(rows);
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode || 500;
    return NextResponse.json({ error: status === 403 ? "Platform admin required" : "Failed to list memberships" }, { status });
  }
}
