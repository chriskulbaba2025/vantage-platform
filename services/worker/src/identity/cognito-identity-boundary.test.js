/**
 * MT-02 frozen proof — the REAL web identity verification boundary
 * (lib/identity/cognito-identity.ts) executes here with a CONTROLLED JWKS
 * injected below the boundary (injected jwksFetcher).  No live AWS calls.
 *
 * Covers the frozen matrix: valid token → principal; expired /
 * bad-signature / wrong-iss / wrong-aud / access-token-use / unknown-kid /
 * malformed → auth failure.  The production RS256 signature verification
 * code is the code under test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { createCognitoIdentityBoundary } from "../../../../lib/identity/cognito-identity.ts";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const KID = "test-kid-rs256-1";

const config = {
  userPoolId: "us-east-1_TESTPOOL01",
  clientId: "test-client-id-123",
  region: "us-east-1",
};
const ISSUER = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;

const controlledJwks = {
  keys: [{ kty: "RSA", kid: KID, alg: "RS256", n: jwk.n, e: jwk.e }],
};

function boundary() {
  return createCognitoIdentityBoundary({ config, jwksFetcher: async () => controlledJwks });
}

function b64u(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload, { kid = KID, alg = "RS256", key = privateKey } = {}) {
  const header = b64u(JSON.stringify({ alg, typ: "JWT", kid }));
  const body = b64u(JSON.stringify(payload));
  const signature = createSign("RSA-SHA256").update(`${header}.${body}`).end().sign(key, "base64url");
  return `${header}.${body}.${signature}`;
}

function claims(overrides = {}) {
  return {
    sub: "sub-controlled-123",
    email: "alice@controlled-test.invalid",
    iss: ISSUER,
    aud: config.clientId,
    token_use: "id",
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

async function expectAuthRejection(token) {
  let threw = false;
  let category = null;
  try {
    await boundary().verifyIdToken(token);
  } catch (err) {
    threw = true;
    category = err?.category || null;
  }
  assert.equal(threw, true, "expected the boundary to reject the token");
  assert.equal(category, "auth", "rejection must be classified as auth");
}

test("MT-02: valid ID token → AuthenticatedPrincipal { sub, email }", async () => {
  const principal = await boundary().verifyIdToken(signJwt(claims()));
  assert.equal(principal.sub, "sub-controlled-123");
  assert.equal(principal.email, "alice@controlled-test.invalid");
});

test("MT-02: expired token rejected", async () => {
  await expectAuthRejection(signJwt(claims({ exp: Math.floor(Date.now() / 1000) - 60 })));
});

test("MT-02: bad signature rejected", async () => {
  const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await expectAuthRejection(signJwt(claims(), { key: otherKey }));
});

test("MT-02: wrong issuer rejected", async () => {
  await expectAuthRejection(signJwt(claims({ iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EVILPOOL" })));
});

test("MT-02: wrong audience rejected", async () => {
  await expectAuthRejection(signJwt(claims({ aud: "some-other-client" })));
});

test("MT-02: access tokens rejected (identity boundary governs ID tokens only)", async () => {
  await expectAuthRejection(signJwt(claims({ token_use: "access" })));
});

test("MT-02: missing subject rejected", async () => {
  const payload = claims();
  delete payload.sub;
  await expectAuthRejection(signJwt(payload));
});

test("MT-02: unknown signing key rejected", async () => {
  await expectAuthRejection(signJwt(claims(), { kid: "unknown-kid" }));
});

test("MT-02: malformed token rejected", async () => {
  await expectAuthRejection("not.a.jwt");
});

test("MT-02: unsupported algorithm rejected", async () => {
  await expectAuthRejection(signJwt(claims(), { alg: "HS256" }));
});
