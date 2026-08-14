/**
 * WP11 Server-Side Worker API Client
 *
 * Runs ONLY on the Next.js server (Route Handlers, Server Components).
 * NEVER imported into client components — would expose credentials.
 *
 * Every browser action → same-origin Next.js Route Handler → this client → Railway worker.
 */

const WORKER_BASE = process.env.VANTAGE_WORKER_API_URL || "http://localhost:3000";
const WORKER_SECRET = process.env.VANTAGE_WEBHOOK_SECRET || "";

interface WorkerClientOpts {
  baseUrl?: string;
  secret?: string;
  /** Authenticated principal — signed per request into the governed
   * x-prysm-principal header (MT-IDENTITY internal boundary). */
  principal?: { sub: string; email: string; displayName?: string };
  /** Server-resolved tenant selection for multi-membership principals.
   * The worker honors this ONLY when membership proves it. */
  tenant?: string;
}

class WorkerClient {
  private baseUrl: string;
  private secret: string;
  private principal: { sub: string; email: string; displayName?: string } | null;
  private tenant: string | null;

  constructor(opts?: WorkerClientOpts) {
    this.baseUrl = opts?.baseUrl || WORKER_BASE;
    this.secret = opts?.secret || WORKER_SECRET;
    this.principal = opts?.principal || null;
    this.tenant = opts?.tenant || null;
  }

  /** Bind this client to an authenticated principal (server-side only). */
  as(principal: { sub: string; email: string; displayName?: string }, tenant?: string): WorkerClient {
    return new WorkerClient({
      baseUrl: this.baseUrl,
      secret: this.secret,
      principal,
      tenant: tenant || this.tenant || undefined,
    });
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-vantage-secret": this.secret,
        ...(init?.headers as Record<string, string> | undefined),
      };
      if (this.principal) {
        const { signPrincipal } = await import("@/lib/identity/principal");
        headers["x-prysm-principal"] = signPrincipal(this.principal as { sub: string; email: string; displayName: string });
        if (this.tenant) headers["x-prysm-tenant"] = this.tenant;
      }
      return await fetch(url, { ...init, signal: controller.signal, headers });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Create and execute a governed audit */
  async createAudit(input: Record<string, unknown>) {
    const res = await this.fetch("/api/v1/audits", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) throw new WorkerApiError(res.status, data.error || "Audit creation failed", data.errors);
    return data;
  }

  /** List tenant-scoped audit history */
  async listAudits() {
    const res = await this.fetch("/api/v1/audits");
    const data = await res.json();
    if (!res.ok) throw new WorkerApiError(res.status, data.error || "Failed to list audits");
    return data;
  }

  /** Get audit status and lifecycle */
  async getAuditStatus(auditId: string) {
    const res = await this.fetch(`/api/v1/audits/${auditId}`);
    if (res.status === 404) return null;
    const data = await res.json();
    if (!res.ok) throw new WorkerApiError(res.status, data.error || "Failed to get audit status");
    return data;
  }

  /** Submit review */
  async submitReview(auditId: string, slug: string, reviewer: string, checklist: unknown[]) {
    const res = await this.fetch(`/api/v1/audits/${auditId}/review`, {
      method: "POST",
      body: JSON.stringify({ slug, reviewer, checklist }),
    });
    const data = await res.json();
    if (!res.ok) throw new WorkerApiError(res.status, data.error || "Review failed");
    return data;
  }

  /** Approve audit */
  async approveAudit(auditId: string, slug: string, approver: string, pages?: Record<string, string>) {
    const res = await this.fetch(`/api/v1/audits/${auditId}/approve`, {
      method: "POST",
      body: JSON.stringify({ slug, approver, pages }),
    });
    const data = await res.json();
    if (!res.ok) throw new WorkerApiError(res.status, data.error || "Approval failed");
    return data;
  }

  /** Resume a stuck audit */
  async resumeAudit(auditId: string) {
    const res = await this.fetch(`/api/v1/audits/${auditId}/resume`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new WorkerApiError(res.status, data.error || "Resume failed");
    return data;
  }

  /** Get report page URL (returns the worker URL for proxying) */
  getReportPageUrl(auditId: string, filename: string, slug: string, clientId: string): string {
    return `${this.baseUrl}/api/v1/audits/${auditId}/report/${filename}?slug=${encodeURIComponent(slug)}&clientId=${encodeURIComponent(clientId)}`;
  }

  /** Proxy a report page request */
  async getReportPage(auditId: string, filename: string, slug: string, clientId: string) {
    const url = this.getReportPageUrl(auditId, filename, slug, clientId);
    const headers: Record<string, string> = { "x-vantage-secret": this.secret };
    if (this.principal) {
      // MT-IDENTITY: report reads MUST carry the signed principal so the
      // worker enforces tenant membership + report role BEFORE artifact
      // retrieval.  The internal (secret-only) boundary remains available
      // to governed non-browser callers.
      const { signPrincipal } = await import("@/lib/identity/principal");
      headers["x-prysm-principal"] = signPrincipal(this.principal as { sub: string; email: string; displayName: string });
      if (this.tenant) headers["x-prysm-tenant"] = this.tenant;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) return { status: res.status, body: null };
      throw new WorkerApiError(res.status, "Failed to get report page");
    }
    const contentType = res.headers.get("content-type") || "text/html; charset=utf-8";
    const body = await res.arrayBuffer();
    return { status: 200, body: Buffer.from(body), contentType };
  }
}

export class WorkerApiError extends Error {
  statusCode: number;
  errors?: unknown[];
  constructor(status: number, message: string, errors?: unknown[]) {
    super(message);
    this.statusCode = status;
    this.errors = errors;
    this.name = "WorkerApiError";
  }
}

export const workerClient = new WorkerClient();
export { WorkerClient };
