import { NextResponse } from "next/server";
import { SESSION_COOKIE, signSession } from "@/lib/identity/session";

/**
 * Temporary PR #77 visual-review entry point.
 * Preview deployments only. Removed before merge.
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse("Not found", { status: 404 });
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(
    SESSION_COOKIE,
    signSession({
      sub: "preview-pr-77",
      email: "reviewer@prysm.test",
      displayName: "PR #77 Reviewer",
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 12 * 60 * 60,
    },
  );
  return response;
}
