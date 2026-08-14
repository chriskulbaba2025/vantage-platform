/**
 * ACCT-PROVISION — disable a membership.
 * The WORKER enforces platform_admin; disabled memberships deny
 * immediately at the next authorization resolution.
 */

import { NextRequest, NextResponse } from "next/server";
import { workerClient } from "@/lib/worker-client";
import { principalFromCookies } from "@/lib/identity/principal";
import { SESSION_COOKIE } from "@/lib/identity/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const principal = principalFromCookies(request.cookies.get(SESSION_COOKIE)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  let body: { tenantId?: string; cognitoSub?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const tenantId = String(body.tenantId || "").trim();
  const cognitoSub = String(body.cognitoSub || "").trim();
  if (!tenantId || !cognitoSub) {
    return NextResponse.json({ error: "Company and user are required" }, { status: 422 });
  }
  try {
    const result = await workerClient.as(principal).adminDisableMembership({ tenantId, cognitoSub });
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode || 500;
    return NextResponse.json({ error: status === 403 ? "Platform admin required" : "Failed to disable the membership" }, { status });
  }
}
