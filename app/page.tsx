import { workerClient } from "@/lib/worker-client";
import { formatAuditDate } from "@/lib/format-time";
import { currentPrincipal } from "@/lib/identity/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const principal = currentPrincipal();
  if (!principal) redirect("/login");

  let audits: unknown[] = [];
  let errorMsg = "";

  try {
    const client = workerClient.as(principal);
    audits = await client.listAudits();
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : "Failed to load audit history";
  }

  function statusClass(state: string): string {
    const s = (state || "").toLowerCase();
    if (s === "approved" || s === "published") return "status-approved";
    if (s.includes("failed") || s.includes("rejected")) return "status-failed";
    if (s.includes("pending") || s.includes("collecting") || s.includes("scored") || s.includes("narrative")) return "status-pending";
    return "status-draft";
  }

  return (
    <div>
      <div className="flex-row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Audit Dashboard</h1>
        <a href="/audits/new" className="btn btn-primary">New Audit</a>
      </div>

      {errorMsg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{errorMsg}</div>}

      {audits.length === 0 && !errorMsg && (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No audits yet. Create your first audit to get started.</p>
        </div>
      )}

      {audits.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>URL</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(audits as Array<Record<string, unknown>>).map((a: Record<string, unknown>) => (
              <tr key={a.auditId as string}>
                <td><strong>{a.businessName as string || a.auditId as string}</strong></td>
                <td style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{a.targetUrl as string || "—"}</td>
                <td><span className={`status-badge ${statusClass(a.latestState as string)}`}>{a.latestState as string}</span></td>
                <td style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{formatAuditDate(a.createdAt as string)}</td>
                <td><a href={`/audits/${a.auditId}`}>View</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
