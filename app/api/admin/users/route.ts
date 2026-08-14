/**
 * ACCT-PROVISION — user invitation.
 *
 * 1. Cognito AdminCreateUser with a random TEMPORARY password.
 *    - production: MessageAction RESEND — Cognito emails the temporary
 *      password to the invited user (the route NEVER returns it).
 *    - non-production: MessageAction SUPPRESS — the temporary password is
 *      returned to the caller so local/E2E flows can complete the invite
 *      without email delivery.
 * 2. The REAL Cognito sub (returned by AdminCreateUser / AdminGetUser) is
 *    persisted as the Prysm user row, and the requested membership role is
 *    assigned.  The WORKER enforces platform_admin on both calls.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { workerClient } from "@/lib/worker-client";
import { principalFromCookies } from "@/lib/identity/principal";
import { SESSION_COOKIE } from "@/lib/identity/session";
import { resolveCognitoConfig } from "@/lib/identity/cognito-identity";

export const dynamic = "force-dynamic";

function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%*";
  const bytes = randomBytes(16);
  let out = "T";
  for (let i = 1; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return out + "a1";
}

function subFromAttributes(attributes?: Array<{ Name?: string; Value?: string }>): string {
  const sub = attributes?.find((a) => a.Name === "sub")?.Value || "";
  if (!sub) throw new Error("Cognito user created without a sub");
  return sub;
}

export async function POST(request: NextRequest) {
  const principal = principalFromCookies(request.cookies.get(SESSION_COOKIE)?.value);
  if (!principal) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { email?: string; tenantId?: string; role?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const tenantId = String(body.tenantId || "").trim();
  const role = String(body.role || "").trim();
  const displayName = String(body.displayName || "").trim() || email.split("@")[0];
  if (!email || !email.includes("@")) return NextResponse.json({ error: "A valid email is required" }, { status: 422 });
  if (!tenantId) return NextResponse.json({ error: "Company is required" }, { status: 422 });
  if (!["viewer", "reviewer", "tenant_admin"].includes(role)) {
    return NextResponse.json({ error: "Role must be viewer, reviewer or tenant_admin" }, { status: 422 });
  }

  const isProd = process.env.NODE_ENV === "production";
  const tempPassword = temporaryPassword();

  // Mock identity mode (local/E2E): skip Cognito entirely — the controlled
  // identity provider below the real boundary derives the mock sub and
  // accepts the fixed temporary password through the challenge flow.
  if (process.env.PRYSM_IDENTITY_MODE === "mock" && !isProd) {
    const mockSub = `mock-${Buffer.from(email.toLowerCase().trim(), "utf8").toString("hex")}`;
    try {
      await workerClient.as(principal).adminInviteUser({ cognitoSub: mockSub, email, displayName });
      await workerClient.as(principal).adminAssignMembership({ tenantId, cognitoSub: mockSub, role });
    } catch (err) {
      return NextResponse.json({ error: "Membership assignment failed" }, { status: (err as { statusCode?: number })?.statusCode || 500 });
    }
    return NextResponse.json({
      invited: true,
      email,
      tenantId,
      role,
      mustSetPassword: true,
      temporaryPassword: "temp-invite-password",
    });
  }

  let cognitoSub = "";
  try {
    const config = resolveCognitoConfig();
    const { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminGetUserCommand } = await import("@aws-sdk/client-cognito-identity-provider");
    const client = new CognitoIdentityProviderClient({ region: config.region });
    try {
      const created = await client.send(new AdminCreateUserCommand({
        UserPoolId: config.userPoolId,
        Username: email,
        TemporaryPassword: tempPassword,
        MessageAction: isProd ? "RESEND" : "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: displayName },
        ],
      }));
      cognitoSub = subFromAttributes(created.User?.Attributes);
    } catch (err) {
      // Already-invited users: recover their existing real sub.
      if ((err as { name?: string })?.name !== "UsernameExistsException") throw err;
      const existing = await client.send(new AdminGetUserCommand({
        UserPoolId: config.userPoolId,
        Username: email,
      }));
      cognitoSub = subFromAttributes(existing.UserAttributes);
    }

    await workerClient.as(principal).adminInviteUser({ cognitoSub, email, displayName });
    await workerClient.as(principal).adminAssignMembership({ tenantId, cognitoSub, role });
  } catch (err) {
    console.error("Invite failed (non-credential error)");
    return NextResponse.json({ error: "Invitation failed" }, { status: 500 });
  }

  return NextResponse.json({
    invited: true,
    email,
    tenantId,
    role,
    mustSetPassword: true,
    ...(isProd ? {} : { temporaryPassword: tempPassword }),
  });
}
