/**
 * POST /api/auth/logout — clear the session cookie.
 */

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/identity/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
