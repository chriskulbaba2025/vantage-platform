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

export interface IdentityProvider {
  /** Authenticate user credentials → authenticated principal.
   * Returns null when credentials are invalid. */
  authenticate(email: string, password: string): Promise<{ sub: string; email: string; displayName: string } | null>;
}

export function createIdentityProvider(): IdentityProvider {
  const mode = process.env.PRYSM_IDENTITY_MODE || "cognito";

  if (mode === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PRYSM_IDENTITY_MODE=mock is not permitted in production");
    }
    return {
      async authenticate(email, _password) {
        if (!email || !email.includes("@")) return null;
        const sub = `mock-${Buffer.from(email.toLowerCase().trim(), "utf8").toString("hex")}`;
        return { sub, email, displayName: email.split("@")[0] };
      },
    };
  }

  // Real Cognito: InitiateAuth (USER_PASSWORD_AUTH) + full JWT verification.
  const config = resolveCognitoConfig();
  const boundary = createCognitoIdentityBoundary({ config });

  return {
    async authenticate(email, password) {
      if (!email || !password) return null;
      try {
        const { CognitoIdentityProviderClient, InitiateAuthCommand, NotAuthorizedException, UserNotFoundException } = await import("@aws-sdk/client-cognito-identity-provider");
        const client = new CognitoIdentityProviderClient({ region: config.region });
        const command = new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: config.clientId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
          },
        });
        const response = await client.send(command);
        const idToken = response.AuthenticationResult?.IdToken;
        if (!idToken) return null;
        const principal = await boundary.verifyIdToken(idToken);
        return { sub: principal.sub, email: principal.email, displayName: "" };
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === "NotAuthorizedException" ||
            err.name === "UserNotFoundException" ||
            (err as { category?: string }).category === "auth")
        ) {
          return null;
        }
        // Do not leak credentials or token details into logs.
        console.error("Cognito authentication failed (non-credential error)");
        throw err;
      }
    },
  };
}
