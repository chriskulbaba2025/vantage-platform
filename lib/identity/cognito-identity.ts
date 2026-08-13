/**
 * Cognito identity boundary — repository-owned integration.
 *
 *   verifyIdToken(idToken) → AuthenticatedPrincipal { sub, email }
 *
 * JWT verification: RS256 signature against the Cognito User Pool JWKS,
 * with iss / aud / token_use / expiry validation.  The real verification
 * code executes in tests with a controlled JWKS below this boundary
 * (injected jwksFetcher) — no live AWS calls.
 *
 * Configuration contract (validated before use):
 *   COGNITO_USER_POOL_ID  — e.g. "ca-central-1_AbCdEf123"
 *   COGNITO_CLIENT_ID     — app client id
 *   COGNITO_REGION        — pool region
 *
 * No customer passwords are stored by Prysm.  No secrets are logged.
 */

import { createPublicKey, createVerify, timingSafeEqual } from "node:crypto";

export interface AuthenticatedPrincipal {
  sub: string;
  email: string;
}

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

interface JwksKey {
  kty: string;
  kid: string;
  alg: string;
  n: string;
  e: string;
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodeJwtPart(token: string, index: 0 | 1): Record<string, unknown> {
  const part = token.split(".")[index];
  if (!part) throw new Error("malformed JWT");
  try {
    return JSON.parse(base64UrlDecode(part).toString("utf8"));
  } catch {
    throw new Error("malformed JWT payload");
  }
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface CognitoIdentityBoundary {
  verifyIdToken(idToken: string): Promise<AuthenticatedPrincipal>;
  config(): CognitoConfig;
}

/**
 * Create the Cognito identity boundary.
 *
 * @param opts
 * @param opts.config — Cognito pool config (validated)
 * @param opts.jwksFetcher — JWKS fetch function; injectable below the
 *   verification boundary for controlled acceptance.  Production uses
 *   fetch against the Cognito JWKS endpoint.
 */
export function createCognitoIdentityBoundary({
  config,
  jwksFetcher,
}: {
  config: CognitoConfig;
  jwksFetcher?: (url: string) => Promise<{ keys: JwksKey[] }>;
}): CognitoIdentityBoundary {
  const jwksUrl = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}/.well-known/jwks.json`;
  const issuer = jwksUrl.replace("/.well-known/jwks.json", "");

  const fetchJwks = jwksFetcher || (async () => {
    const res = await fetch(jwksUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Cognito JWKS fetch failed (${res.status})`);
    return res.json() as Promise<{ keys: JwksKey[] }>;
  });

  async function verifyIdToken(idToken: string): Promise<AuthenticatedPrincipal> {
    if (!idToken || typeof idToken !== "string") {
      throw Object.assign(new Error("ID token required"), { category: "auth" });
    }

    // 1. Structural decode (header for kid/alg; payload for claims).
    const header = decodeJwtPart(idToken, 0) as Record<string, unknown>;
    const payload = decodeJwtPart(idToken, 1);
    if (header.alg !== "RS256") {
      throw Object.assign(new Error("Unsupported token algorithm"), { category: "auth" });
    }

    // 2. Claims validation.
    const now = Math.floor(Date.now() / 1000);
    if (payload.token_use !== "id" && payload.token_use !== "access") {
      throw Object.assign(new Error("Invalid token_use claim"), { category: "auth" });
    }
    if (typeof payload.exp !== "number" || payload.exp < now) {
      throw Object.assign(new Error("Token expired"), { category: "auth" });
    }
    if (typeof payload.iss !== "string" || !constantTimeStringEqual(payload.iss, issuer)) {
      throw Object.assign(new Error("Token issuer mismatch"), { category: "auth" });
    }
    if (typeof payload.aud === "string") {
      if (!constantTimeStringEqual(payload.aud, config.clientId)) {
        throw Object.assign(new Error("Token audience mismatch"), { category: "auth" });
      }
    } else if (Array.isArray(payload.aud)) {
      if (!payload.aud.some((a) => typeof a === "string" && constantTimeStringEqual(a, config.clientId))) {
        throw Object.assign(new Error("Token audience mismatch"), { category: "auth" });
      }
    } else {
      throw Object.assign(new Error("Token audience missing"), { category: "auth" });
    }
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw Object.assign(new Error("Token subject missing"), { category: "auth" });
    }

    // 3. Signature verification against the pool JWKS.
    const jwks = await fetchJwks(jwksUrl);
    const key = jwks.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!key) throw Object.assign(new Error("Unknown signing key"), { category: "auth" });

    const publicKey = createPublicKey({
      key: {
        kty: "RSA",
        n: Buffer.from(key.n, "base64url").toString("base64"),
        e: Buffer.from(key.e, "base64url").toString("base64"),
      },
      format: "jwk",
    });
    const [signed, signature] = [idToken.split(".").slice(0, 2).join("."), idToken.split(".")[2]];
    if (!signature) throw Object.assign(new Error("Token signature missing"), { category: "auth" });
    const verify = createVerify("RSA-SHA256");
    verify.update(signed);
    verify.end();
    if (!verify.verify(publicKey, base64UrlDecode(signature))) {
      throw Object.assign(new Error("Token signature invalid"), { category: "auth" });
    }

    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
    };
  }

  return Object.freeze({ verifyIdToken, config: () => config });
}

/** Resolve the Cognito config from the environment contract; throws when
 * incomplete. */
export function resolveCognitoConfig(env: NodeJS.ProcessEnv = process.env): CognitoConfig {
  const userPoolId = env.COGNITO_USER_POOL_ID || "";
  const clientId = env.COGNITO_CLIENT_ID || "";
  const region = env.COGNITO_REGION || "";
  const missing: string[] = [];
  if (!userPoolId) missing.push("COGNITO_USER_POOL_ID");
  if (!clientId) missing.push("COGNITO_CLIENT_ID");
  if (!region) missing.push("COGNITO_REGION");
  if (missing.length > 0) {
    throw new Error(`Cognito configuration incomplete: ${missing.join(", ")}`);
  }
  return { userPoolId, clientId, region };
}
