import { workerClient, WorkerApiError } from "@/lib/worker-client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { auditId: string } },
) {
  try {
    const result = await workerClient.resumeAudit(params.auditId);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof WorkerApiError) {
      return NextResponse.json({ error: e.message, errors: e.errors }, { status: e.statusCode });
    }
    console.error("Audit resume API error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
