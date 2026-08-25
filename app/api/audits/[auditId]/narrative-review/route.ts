import { randomUUID } from "node:crypto";
import { workerClient, WorkerApiError } from "@/lib/worker-client";
import { NextRequest, NextResponse } from "next/server";
import { principalFromCookies } from "@/lib/identity/principal";
import { SESSION_COOKIE } from "@/lib/identity/session";

function resolvePrincipal(request: NextRequest) {
  return principalFromCookies(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
}

/**
 * Read the persisted Narrative v2 human-review result.
 *
 * This route is read-only. It does not execute Writer, Judge, evidence
 * collection, scoring, or any other production mutation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { auditId: string } },
) {
  const principal = resolvePrincipal(request);

  if (!principal) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const client = workerClient.as(principal);
    const result = await client.getNarrativeV2HumanReview(params.auditId);

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof WorkerApiError) {
      return NextResponse.json(
        {
          error: e.message,
          errors: e.errors,
        },
        { status: e.statusCode },
      );
    }

    console.error("Narrative v2 human-review API error:", e);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Explicitly authorize the single governed final Narrative v2 pass.
 *
 * The authenticated POST itself is the human authorization event. A unique
 * authorization identifier is generated server-side and passed through the
 * governed worker/runtime boundary.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { auditId: string } },
) {
  const principal = resolvePrincipal(request);

  if (!principal) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const body = await request.json();

    if (body?.confirmFinalPass !== true) {
      return NextResponse.json(
        {
          error: "Explicit final-pass confirmation is required",
          code: "NARRATIVE_V2_FINAL_PASS_CONFIRMATION_REQUIRED",
        },
        { status: 422 },
      );
    }

    const authorizationId =
      `narrative-final-pass:${params.auditId}:${randomUUID()}`;

    const client = workerClient.as(principal);

    const result = await client.continueNarrativeV2FinalPass(
      params.auditId,
      authorizationId,
    );

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof WorkerApiError) {
      return NextResponse.json(
        {
          error: e.message,
          errors: e.errors,
        },
        { status: e.statusCode },
      );
    }

    console.error("Narrative v2 final-pass API error:", e);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}