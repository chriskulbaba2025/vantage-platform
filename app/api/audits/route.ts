/**
 * WP11 Same-Origin API Route — POST /api/audits
 *
 * Browser → this Next.js Route Handler → Railway worker /api/v1/audits
 * The worker secret stays on the server.
 */

import { workerClient, WorkerApiError } from "@/lib/worker-client";
import { NextRequest, NextResponse } from "next/server";
import { principalFromCookies } from "@/lib/identity/principal";
import { SESSION_COOKIE } from "@/lib/identity/session";

export async function POST(request: NextRequest) {
  // MT-IDENTITY: server-side session verification before the worker call.
  const principal = principalFromCookies(request.cookies.get(SESSION_COOKIE)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const client = workerClient.as(principal);
    const result = await client.createAudit(body);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof WorkerApiError) {
      return NextResponse.json({ error: e.message, errors: e.errors }, { status: e.statusCode });
    }
    console.error("Audit API error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
