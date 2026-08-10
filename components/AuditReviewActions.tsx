"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const REVIEW_ITEMS = [
  ["source_failures", "Source failures and partial coverage"],
  ["top_ten_findings", "Top ten findings"],
  ["high_severity", "High-severity findings"],
  ["competitor_selections", "Competitor selections"],
  ["internal_link_recommendations", "Internal-link recommendations"],
  ["root_cause", "Root cause"],
  ["score_eligibility", "Score eligibility"],
  ["limitations", "Limitations"],
  ["causal_language", "Causal language"],
  ["implementation_feasibility", "Implementation feasibility"],
] as const;

const ACTIVE_STATES = new Set([
  "created",
  "validated",
  "collecting",
  "evidence_stored",
  "evidence_locked",
  "scored",
  "narrative_pending",
  "narrative_ready",
]);

export default function AuditReviewActions({
  auditId,
  state,
  slug,
}: {
  auditId: string;
  state: string;
  slug: string;
}) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState("");
  const [approver, setApprover] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ACTIVE_STATES.has(state)) return;
    const timer = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [router, state]);

  const allChecked = useMemo(
    () => REVIEW_ITEMS.every(([id]) => checked[id] === true),
    [checked],
  );

  async function submitReview() {
    setError("");
    if (!reviewer.trim() || !allChecked) {
      setError("Enter a reviewer name and complete all review checks.");
      return;
    }
    setBusy(true);
    try {
      const reviewedAt = new Date().toISOString();
      const checklist = REVIEW_ITEMS.map(([id]) => ({ id, reviewed: true, reviewedAt }));
      const response = await fetch(`/api/audits/${auditId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, reviewer: reviewer.trim(), checklist }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Review failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setError("");
    if (!approver.trim()) {
      setError("Enter an approver name.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/audits/${auditId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, approver: approver.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Approval failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  if (ACTIVE_STATES.has(state)) {
    return (
      <div className="card">
        <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Audit running</h2>
        <p style={{ margin: 0 }}>Prysm is collecting evidence and building the governed report. This page refreshes automatically.</p>
      </div>
    );
  }

  if (state === "draft_rendered") {
    return (
      <div className="card">
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Review Draft</h2>
        <div className="form-group">
          <label htmlFor="reviewer">Reviewer</label>
          <input id="reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Reviewer name" />
        </div>
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {REVIEW_ITEMS.map(([id, label]) => (
            <label key={id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={checked[id] === true}
                onChange={(e) => setChecked((current) => ({ ...current, [id]: e.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" type="button" disabled={busy || !allChecked} onClick={submitReview}>
          {busy ? "Submitting Review..." : "Submit Review"}
        </button>
      </div>
    );
  }

  if (state === "in_review") {
    return (
      <div className="card" style={{ borderColor: "var(--amber)" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Approve Report</h2>
        <div className="form-group">
          <label htmlFor="approver">Approver</label>
          <input id="approver" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Approver name" />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" type="button" disabled={busy} onClick={approve}>
          {busy ? "Approving..." : "Approve Report"}
        </button>
      </div>
    );
  }

  return null;
}
