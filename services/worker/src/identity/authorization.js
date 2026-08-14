/**
 * Prysm Identity — server-side authorization resolution.
 *
 * The Prysm database is the authorization source of truth:
 *
 *   verified principal (HMAC-signed x-prysm-principal header)
 *   → prysm.users row by cognito_sub
 *   → active tenant_memberships
 *   → authorized tenant set
 *   → selected tenant validated against the set (platform_admin: explicit
 *     cross-tenant override)
 *
 * Browser-supplied tenant identity is NEVER trusted on its own: the
 * x-prysm-tenant header is honored only when the membership lookup proves
 * the user belongs to that tenant (or the user is platform_admin).
 *
 * @module identity/authorization
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ROLES } from "./identity-model.js";

const PRINCIPAL_HEADER = "x-prysm-principal";
const SELECTED_TENANT_HEADER = "x-prysm-tenant";

/** Maximum principal token age (seconds). */
const PRINCIPAL_MAX_AGE_S = 60;

function hmac(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Sign an authenticated principal into a short-lived bearer token.
 * Produced by the trusted web server (which verified the Cognito token)
 * and verified by the worker with the shared secret.
 *
 * @param {object} opts
 * @param {string} opts.secret — shared webhook secret
 * @param {object} opts.principal — { sub, email, displayName }
 * @param {number} [opts.maxAgeS]
 */
export function signPrincipal({ secret, principal, maxAgeS = PRINCIPAL_MAX_AGE_S, nowMs }) {
  const issuedAt = Math.floor((nowMs ?? Date.now()) / 1000);
  const payload = {
    sub: String(principal.sub || ""),
    email: String(principal.email || ""),
    displayName: String(principal.displayName || ""),
    iat: issuedAt,
    exp: issuedAt + maxAgeS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = hmac(secret, body);
  return `${body}.${signature}`;
}

/**
 * Verify a signed principal token.  Returns the payload or null.
 * Constant-time signature comparison; expiry enforced.
 */
export function verifyPrincipal({ secret, token, nowMs }) {
  if (!secret || !token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = Buffer.from(hmac(secret, body), "hex");
  const received = Buffer.from(signature, "hex");
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.sub !== "string" || payload.sub.length === 0) return null;

  const now = Math.floor((nowMs ?? Date.now()) / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload;
}

/**
 * Resolve the authorized context for a worker request.
 *
 * @param {object} opts
 * @param {object} opts.req — Node http request
 * @param {string} opts.secret — shared webhook secret
 * @param {object} opts.identityRepo — identity repository
 * @param {number} [opts.nowMs]
 * @returns {Promise<{ authenticated: false, reason: string } |
 *                   { authenticated: true, principal, user, roles: string[],
 *                     memberships: object[], selectedTenant: string|null }>}
 */
export async function resolveAuthorization({ req, secret, identityRepo, nowMs }) {
  const token = req.headers[PRINCIPAL_HEADER];
  const selectedTenant = typeof req.headers[SELECTED_TENANT_HEADER] === "string"
    ? req.headers[SELECTED_TENANT_HEADER].trim()
    : null;

  const principal = verifyPrincipal({ secret, token, nowMs });
  if (!principal) {
    return { authenticated: false, reason: "invalid or expired principal token" };
  }

  const user = await identityRepo.findUserByCognitoSub(principal.sub);
  if (!user) {
    return { authenticated: false, reason: "no Prysm user for authenticated principal" };
  }
  if (user.status !== "active") {
    return { authenticated: false, reason: "user disabled" };
  }

  const membershipRows = await identityRepo.findMembershipsForUser(user.id);
  const activeMemberships = membershipRows.filter((m) => m.status === "active");
  if (activeMemberships.length === 0) {
    return { authenticated: false, reason: "no active tenant membership" };
  }

  const roles = [...new Set(activeMemberships.map((m) => m.role))];
  const isPlatformAdmin = roles.includes(ROLES.PLATFORM_ADMIN);

  // Tenant selection: honored only when membership proves it (or the
  // explicit platform_admin cross-tenant override applies).
  let authorizedTenant = null;
  if (selectedTenant) {
    const belongs = activeMemberships.some((m) => m.tenant_id === selectedTenant);
    if (!belongs && !isPlatformAdmin) {
      return { authenticated: false, reason: "selected tenant not authorized" };
    }
    authorizedTenant = selectedTenant;
  } else if (activeMemberships.length === 1 && !isPlatformAdmin) {
    authorizedTenant = activeMemberships[0].tenant_id;
  }
  // Multiple memberships without an explicit selection → caller must select.

  return {
    authenticated: true,
    principal,
    user,
    roles,
    memberships: activeMemberships,
    selectedTenant: authorizedTenant,
    isPlatformAdmin,
  };
}

/**
 * Tenant-scope guard: does the authorized context permit access to the
 * given tenant?
 * platform_admin → always.  Otherwise membership must include the tenant.
 */
export function canAccessTenant(auth, tenantId) {
  if (!auth.authenticated) return false;
  if (auth.isPlatformAdmin) return true;
  return auth.memberships.some((m) => m.tenant_id === tenantId);
}

export { PRINCIPAL_HEADER, SELECTED_TENANT_HEADER, PRINCIPAL_MAX_AGE_S };
export default { signPrincipal, verifyPrincipal, resolveAuthorization, canAccessTenant };
