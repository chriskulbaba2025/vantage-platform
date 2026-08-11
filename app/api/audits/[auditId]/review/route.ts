import { workerClient, WorkerApiError } from "@/lib/worker-client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { auditId: string } },
) {
  try {
    const body = await request.json();
    const slug = String(body.slug || "").trim();
    const reviewer = String(body.reviewer || "").trim();
    const checklist = Array.isArray(body.checklist) ? body.checklist : [];

    if (!slug || !reviewer) {
      return NextResponse.json({ error: "Reviewer and audit slug are required" }, { status: 422 });
    }

    const result = await workerClient.submitReview(params.auditId, slug, reviewer, checklist);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof WorkerApiError) {
      return NextResponse.json({ error: e.message, errors: e.errors }, { status: e.statusCode });
    }
    console.error("Audit review API error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
