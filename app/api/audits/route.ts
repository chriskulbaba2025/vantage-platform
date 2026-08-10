/**
 * WP11 Same-Origin API Route — POST /api/audits
 *
 * Browser → this Next.js Route Handler → Railway worker /api/v1/audits
 * The worker secret stays on the server.
 */

import { workerClient, WorkerApiError } from "@/lib/worker-client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await workerClient.createAudit(body);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof WorkerApiError) {
      return NextResponse.json({ error: e.message, errors: e.errors }, { status: e.statusCode });
    }
    console.error("Audit API error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
