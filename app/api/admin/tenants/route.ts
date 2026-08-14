/**
 * ACCT-PROVISION — company (tenant) administration.
 *
 * Requires an authenticated portal session.  The WORKER is the
 * authorization layer: these routes pass the signed principal through and
 * the worker admits only platform_admin principals (or the governed
 * internal boundary).
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
  try {
    const tenants = await workerClient.as(principal).adminListTenants();
    return NextResponse.json(tenants);
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode || 500;
    return NextResponse.json({ error: status === 403 ? "Platform admin required" : "Failed to list companies" }, { status });
  }
}

export async function POST(request: NextRequest) {
  const principal = principalFromCookies(request.cookies.get(SESSION_COOKIE)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  let body: { name?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Company name is required" }, { status: 422 });
  }
  try {
    const created = await workerClient.as(principal).adminCreateTenant({ name, id: body.id?.trim() || undefined });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode || 500;
    return NextResponse.json({ error: status === 403 ? "Platform admin required" : "Failed to create company" }, { status });
  }
}
