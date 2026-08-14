/**
 * Identity provider selection — the clean boundary around Cognito.
 *
 *   PRYSM_IDENTITY_MODE = "cognito" (production) | "mock" (controlled
 *   acceptance / local development)
 *
 * "mock" is a controlled identity fixture BELOW the real identity
 * verification boundary: it exists only for local acceptance and is
 * rejected when NODE_ENV === "production".  The real Cognito verification
 * code executes in tests with a controlled JWKS.
 */

import { createCognitoIdentityBoundary, resolveCognitoConfig } from "./cognito-identity";

export type AuthenticateResult =
  | { status: "authenticated"; sub: string; email: string; displayName: string }
  | { status: "challenge"; challenge: "NEW_PASSWORD_REQUIRED"; email: string; cognitoSession: string }
  | { status: "invalid" };

export interface IdentityProvider {
  /** Authenticate user credentials → discriminated result.
   * "challenge" means the credential was accepted but Cognito requires
   * the user to establish a NEW password (invite flow). */
  authenticate(email: string, password: string): Promise<AuthenticateResult>;
  /** Complete the NEW_PASSWORD_REQUIRED challenge with the user's own
   * password → authenticated principal. */
  completeNewPassword(email: string, newPassword: string, cognitoSession: string): Promise<AuthenticateResult>;
}

export function createIdentityProvider(): IdentityProvider {
  const mode = process.env.PRYSM_IDENTITY_MODE || "cognito";

  if (mode === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PRYSM_IDENTITY_MODE=mock is not permitted in production");
    }
    return {
      async authenticate(email, password) {
        if (!email || !email.includes("@")) return { status: "invalid" };
        if (password === "temp-invite-password") {
          return { status: "challenge", challenge: "NEW_PASSWORD_REQUIRED", email, cognitoSession: `mock-session-${email}` };
        }
        const sub = `mock-${Buffer.from(email.toLowerCase().trim(), "utf8").toString("hex")}`;
        return { status: "authenticated", sub, email, displayName: email.split("@")[0] };
      },
      async completeNewPassword(email, newPassword, _cognitoSession) {
        if (!email || !newPassword || newPassword.length < 8) return { status: "invalid" };
        const sub = `mock-${Buffer.from(email.toLowerCase().trim(), "utf8").toString("hex")}`;
        return { status: "authenticated", sub, email, displayName: email.split("@")[0] };
      },
    };
  }

  // Real Cognito: InitiateAuth (USER_PASSWORD_AUTH) + full JWT verification.
  const config = resolveCognitoConfig();
  const boundary = createCognitoIdentityBoundary({ config });

  async function cognitoPrincipal(idToken: string, email: string) {
    const principal = await boundary.verifyIdToken(idToken);
    return { status: "authenticated" as const, sub: principal.sub, email: principal.email || email, displayName: "" };
  }

  return {
    async authenticate(email, password) {
      if (!email || !password) return { status: "invalid" };
      try {
        const { CognitoIdentityProviderClient, InitiateAuthCommand } = await import("@aws-sdk/client-cognito-identity-provider");
        const client = new CognitoIdentityProviderClient({ region: config.region });
        const response = await client.send(new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: config.clientId,
          AuthParameters: { USERNAME: email, PASSWORD: password },
        }));
        if (response.ChallengeName === "NEW_PASSWORD_REQUIRED" && response.Session) {
          return { status: "challenge", challenge: "NEW_PASSWORD_REQUIRED", email, cognitoSession: response.Session };
        }
        const idToken = response.AuthenticationResult?.IdToken;
        if (!idToken) return { status: "invalid" };
        return cognitoPrincipal(idToken, email);
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === "NotAuthorizedException" ||
            err.name === "UserNotFoundException" ||
            (err as { category?: string }).category === "auth")
        ) {
          return { status: "invalid" };
        }
        // Do not leak credentials or token details into logs.
        console.error("Cognito authentication failed (non-credential error)");
        throw err;
      }
    },
    async completeNewPassword(email, newPassword, cognitoSession) {
      if (!email || !newPassword || !cognitoSession) return { status: "invalid" };
      try {
        const { CognitoIdentityProviderClient, RespondToAuthChallengeCommand } = await import("@aws-sdk/client-cognito-identity-provider");
        const client = new CognitoIdentityProviderClient({ region: config.region });
        const response = await client.send(new RespondToAuthChallengeCommand({
          ChallengeName: "NEW_PASSWORD_REQUIRED",
          ClientId: config.clientId,
          Session: cognitoSession,
          ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
        }));
        const idToken = response.AuthenticationResult?.IdToken;
        if (!idToken) return { status: "invalid" };
        return cognitoPrincipal(idToken, email);
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === "NotAuthorizedException" || err.name === "InvalidPasswordException" || err.name === "CodeMismatchException")
        ) {
          return { status: "invalid" };
        }
        console.error("Cognito new-password completion failed (non-credential error)");
        throw err;
      }
    },
  };
}
