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
const TENANT_ID = process.env.VANTAGE_TENANT_ID || "default";

interface WorkerClientOpts {
  baseUrl?: string;
  secret?: string;
  tenantId?: string;
}

class WorkerClient {
  private baseUrl: string;
  private secret: string;
  private tenantId: string;

  constructor(opts?: WorkerClientOpts) {
    this.baseUrl = opts?.baseUrl || WORKER_BASE;
    this.secret = opts?.secret || WORKER_SECRET;
    this.tenantId = opts?.tenantId || TENANT_ID;
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    return fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-vantage-secret": this.secret,
        ...(init?.headers || {}),
      },
    });
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

  /** Get report page URL (returns the worker URL for proxying) */
  getReportPageUrl(auditId: string, filename: string, slug: string, clientId: string): string {
    return `${this.baseUrl}/api/v1/audits/${auditId}/report/${filename}?slug=${encodeURIComponent(slug)}&clientId=${encodeURIComponent(clientId)}`;
  }

  /** Proxy a report page request */
  async getReportPage(auditId: string, filename: string, slug: string, clientId: string) {
    const url = this.getReportPageUrl(auditId, filename, slug, clientId);
    const res = await fetch(url, {
      headers: { "x-vantage-secret": this.secret },
    });
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
