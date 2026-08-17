import { workerClient } from "@/lib/worker-client";
import AuditReviewActions from "@/components/AuditReviewActions";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { REVIEWER_COOKIE, isValidReviewerToken } from "@/lib/reviewer-auth";
import { currentPrincipal } from "@/lib/identity/session";

export const dynamic = "force-dynamic";

export default async function AuditDetailPage({ params }: { params: { auditId: string } }) {
  const { auditId } = params;

  // MT-IDENTITY: authenticated portal access — the worker enforces the
  // tenant boundary server-side; the session carries only the principal.
  const principal = currentPrincipal();
  if (!principal) redirect("/login");

  let status;
  let fetchError = "";
  try {
    const client = workerClient.as(principal);
    status = await client.getAuditStatus(auditId);
  } catch (e) {
    console.error("Worker fetch failed:", e);
    fetchError = "Worker unavailable";
  }
  if (!status && !fetchError) notFound();

  const stateClass = (s: string): string => {
    const st = (s || "").toLowerCase();
    if (st === "approved" || st === "published") return "status-approved";
    if (st.includes("failed") || st.includes("rejected")) return "status-failed";
    if (st === "draft_rendered" || st === "in_review") return "status-pending";
    return "status-draft";
  };

  if (fetchError) {
    return (
      <div>
        <h1>Audit Status</h1>
        <div className="card" style={{ borderColor: "var(--amber)", color: "var(--amber)" }}>
          <p><strong>Worker unavailable.</strong> The audit engine is temporarily unreachable. Please try again shortly.</p>
        </div>
      </div>
    );
  }

  const state = String(status!.state || "");
  const slug = String(status!.slug || "");

  return (
    <div>
      <div className="flex-row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{status!.businessName || "Audit Status"}</h1>
        <span className={`status-badge ${stateClass(state)}`}>{state}</span>
      </div>

      <div className="card">
        {status!.targetUrl && <p><strong>Website:</strong> {status!.targetUrl}</p>}
        {(status! as Record<string, unknown>).services && ((status! as Record<string, unknown>).services as string[]).length > 0 && (
          <p><strong>Services:</strong> {((status! as Record<string, unknown>).services as string[]).join(", ")}</p>
        )}
        {(status! as Record<string, unknown>).primaryGoal && (
          <p><strong>Primary goal:</strong> {(status! as Record<string, unknown>).primaryGoal as string}</p>
        )}
        {(status! as Record<string, unknown>).market && (
          <p><strong>Market:</strong> {(status! as Record<string, unknown>).market as string}</p>
        )}
        {(status! as Record<string, unknown>).reportDesignVersion === "2.0.0" && (
          <p><strong>Report design:</strong> 2.0.0 — Executive conversion-readiness report</p>
        )}
        <p><strong>Audit ID:</strong> <code>{auditId}</code></p>
        <p><strong>Version:</strong> {status!.version}</p>
        <p><strong>Created:</strong> {status!.createdAt ? new Date(status!.createdAt).toLocaleString() : "—"}</p>
        <p><strong>Updated:</strong> {status!.updatedAt ? new Date(status!.updatedAt).toLocaleString() : "—"}</p>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Lifecycle History</h2>
        <table>
          <thead>
            <tr><th>From</th><th>To</th><th>Time</th></tr>
          </thead>
          <tbody>
            {(status!.lifecycle || []).map((e: Record<string, unknown>, i: number) => (
              <tr key={i}>
                <td>{e.from as string || "—"}</td>
                <td><span className={`status-badge ${stateClass(e.to as string)}`}>{e.to as string}</span></td>
                <td style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{e.at ? new Date(e.at as string).toLocaleTimeString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AuditReviewActions auditId={auditId} state={state} slug={slug} />

      {(state === "draft_rendered" || state === "in_review") && (
        <div className="card" style={{ borderColor: "var(--amber)" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Draft Report</h2>
          {/* PRYSM-NEXT-ACTIVATION defect B — a separately authenticated
              principal reaches the draft report through their session; the
              WORKER still enforces the tenant/role gate server-side before
              any report bytes are served.  The legacy reviewer-session
              cookie remains supported for internal reviewer compatibility. */}
          {principal || isValidReviewerToken(cookies().get(REVIEWER_COOKIE)?.value) ? (
            <>
              <p>The governed draft report is ready. Access is enforced by your account role.</p>
              <a href={`/audits/${auditId}/report`} className="btn btn-primary">View Draft Report</a>
            </>
          ) : (
            <p>Draft reports are reviewer-only. Sign in as a reviewer to open the internal review page.</p>
          )}
        </div>
      )}

      {(state === "approved" || state === "published") && (
        <div className="card" style={{ borderColor: "var(--green)" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Approved Report</h2>
          <p>The governed report is approved and ready to review.</p>
          <a href={`/audits/${auditId}/report`} className="btn btn-primary">View Report</a>
        </div>
      )}
    </div>
  );
}
