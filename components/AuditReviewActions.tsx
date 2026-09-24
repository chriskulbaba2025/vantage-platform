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

type NarrativeReview = Record<string, unknown>;

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
  const [narrativeReview, setNarrativeReview] =
    useState<NarrativeReview | null>(null);
  const [narrativeReviewLoading, setNarrativeReviewLoading] = useState(false);

  useEffect(() => {
    if (!ACTIVE_STATES.has(state)) return;

    const timer = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [router, state]);

  useEffect(() => {
    if (state !== "narrative_failed") {
      setNarrativeReview(null);
      return;
    }

    let cancelled = false;

    async function loadNarrativeReview() {
      setNarrativeReviewLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/audits/${auditId}/narrative-review`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "Failed to load Narrative v2 human review",
          );
        }

        if (!cancelled) {
          setNarrativeReview(data);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Failed to load Narrative v2 human review",
          );
        }
      } finally {
        if (!cancelled) {
          setNarrativeReviewLoading(false);
        }
      }
    }

    void loadNarrativeReview();

    return () => {
      cancelled = true;
    };
  }, [auditId, state]);

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
      const checklist = REVIEW_ITEMS.map(([id]) => ({
        id,
        reviewed: true,
        reviewedAt,
      }));

      const response = await fetch(`/api/audits/${auditId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          reviewer: reviewer.trim(),
          checklist,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Review failed");
      }

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
        body: JSON.stringify({
          slug,
          approver: approver.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Approval failed");
      }

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function authorizeNarrativeFinalPass() {
    setError("");
    setBusy(true);

    try {
      const response = await fetch(
        `/api/audits/${auditId}/narrative-review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmFinalPass: true,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Narrative v2 final-pass continuation failed",
        );
      }

      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Narrative v2 final-pass continuation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  if (ACTIVE_STATES.has(state)) {
    return (
      <div className="card">
        <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>
          Audit running
        </h2>
        <p style={{ margin: 0 }}>
          Prysm is collecting evidence and building the governed report. This
          page refreshes automatically.
        </p>
      </div>
    );
  }

  if (state === "narrative_failed") {
    return (
      <div className="card" style={{ borderColor: "var(--amber)" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>
          Narrative review required
        </h2>

        <p style={{ marginTop: 0, marginBottom: 16 }}>
          The report passed evidence collection and scoring, but the Narrative
          v2 Judge did not authorize client release within the automatic
          revision limit. Review the governed Judge result below before
          authorizing the single final revision pass.
        </p>

        {narrativeReviewLoading && (
          <p style={{ marginBottom: 16 }}>
            Loading governed Judge review...
          </p>
        )}

        {narrativeReview && (
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: 8 }}>
              Governed Judge review
            </h3>

            <pre
              style={{
                margin: 0,
                padding: 12,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "var(--surface-subtle, #f6f7f8)",
                borderRadius: 6,
                fontSize: "0.8rem",
                lineHeight: 1.5,
              }}
            >
              {JSON.stringify(narrativeReview, null, 2)}
            </pre>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || narrativeReviewLoading || !narrativeReview}
          onClick={authorizeNarrativeFinalPass}
        >
          {busy
            ? "Running Final Narrative Pass..."
            : "Authorize Final Narrative Pass"}
        </button>

        <p
          style={{
            marginTop: 12,
            marginBottom: 0,
            fontSize: "0.85rem",
          }}
        >
          This authorizes one final governed Writer/Judge round only. It does
          not recollect evidence or rerun scoring.
        </p>
      </div>
    );
  }

  if (state === "draft_rendered") {
    return (
      <div className="card">
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>
          Review Draft
        </h2>

        <div className="form-group">
          <label htmlFor="reviewer">Reviewer</label>
          <input
            id="reviewer"
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Reviewer name"
          />
        </div>

        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {REVIEW_ITEMS.map(([id, label]) => (
            <label
              key={id}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                type="checkbox"
                checked={checked[id] === true}
                onChange={(e) =>
                  setChecked((current) => ({
                    ...current,
                    [id]: e.target.checked,
                  }))
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {error && <p className="form-error">{error}</p>}

        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || !allChecked}
          onClick={submitReview}
        >
          {busy ? "Submitting Review..." : "Submit Review"}
        </button>
      </div>
    );
  }

  if (state === "in_review") {
    return (
      <div className="card" style={{ borderColor: "var(--amber)" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>
          Approve Report
        </h2>

        <div className="form-group">
          <label htmlFor="approver">Approver</label>
          <input
            id="approver"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="Approver name"
          />
        </div>

        {error && <p className="form-error">{error}</p>}

        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={approve}
        >
          {busy ? "Approving..." : "Approve Report"}
        </button>
      </div>
    );
  }

  return null;
}
