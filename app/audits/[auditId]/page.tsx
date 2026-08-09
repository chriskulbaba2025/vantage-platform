import { workerClient } from "@/lib/worker-client";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const REVIEW_CHECKLIST_ITEMS = [
  { id: "source_failures", label: "Source failures and partial coverage" },
  { id: "top_ten_findings", label: "Top ten findings" },
  { id: "high_severity", label: "High-severity findings" },
  { id: "competitor_selections", label: "Competitor selections" },
  { id: "internal_link_recommendations", label: "Internal-link recommendations" },
  { id: "root_cause", label: "Root cause" },
  { id: "score_eligibility", label: "Score eligibility" },
  { id: "limitations", label: "Limitations" },
  { id: "causal_language", label: "Causal language" },
  { id: "implementation_feasibility", label: "Implementation feasibility" },
];

export default async function AuditDetailPage({ params }: { params: { auditId: string } }) {
  const { auditId } = params;
  const status = await workerClient.getAuditStatus(auditId);
  if (!status) notFound();

  const stateClass = (s: string): string => {
    const st = (s || "").toLowerCase();
    if (st === "approved" || st === "published") return "status-approved";
    if (st.includes("failed") || st.includes("rejected")) return "status-failed";
    if (st === "draft_rendered" || st === "in_review") return "status-pending";
    return "status-draft";
  };

  return (
    <div>
      <div className="flex-row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Audit Status</h1>
        <span className={`status-badge ${stateClass(status.state)}`}>{status.state}</span>
      </div>

      <div className="card">
        <p><strong>Audit ID:</strong> <code>{auditId}</code></p>
        <p><strong>Version:</strong> {status.version}</p>
        <p><strong>Created:</strong> {status.createdAt ? new Date(status.createdAt).toLocaleString() : "—"}</p>
        <p><strong>Updated:</strong> {status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "—"}</p>
      </div>

      {/* Lifecycle History */}
      <div className="card">
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Lifecycle History</h2>
        <table>
          <thead>
            <tr><th>From</th><th>To</th><th>Time</th></tr>
          </thead>
          <tbody>
            {(status.lifecycle || []).map((e: Record<string, unknown>, i: number) => (
              <tr key={i}>
                <td>{e.from as string || "—"}</td>
                <td><span className={`status-badge ${stateClass(e.to as string)}`}>{e.to as string}</span></td>
                <td style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{e.at ? new Date(e.at as string).toLocaleTimeString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Report Viewer — only for approved/published */}
      {(status.state === "approved" || status.state === "published") && (
        <div className="card" style={{ borderColor: "var(--green)" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Approved Report</h2>
          <a href={`/audits/${auditId}/report`} className="btn btn-primary">View Report</a>
        </div>
      )}
    </div>
  );
}
