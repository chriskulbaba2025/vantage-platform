import { workerClient, WorkerApiError } from "@/lib/worker-client";
import { NextRequest, NextResponse } from "next/server";
import { principalFromCookies } from "@/lib/identity/principal";
import { SESSION_COOKIE } from "@/lib/identity/session";

export async function POST(
  request: NextRequest,
  { params }: { params: { auditId: string } },
) {
  const principal = principalFromCookies(request.cookies.get(SESSION_COOKIE)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await workerClient.as(principal).resumeAudit(params.auditId);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof WorkerApiError) {
      return NextResponse.json({ error: e.message, errors: e.errors }, { status: e.statusCode });
    }
    console.error("Audit resume API error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
