"use client";

import { useState } from "react";
import { validateAuditForm, buildAuditPayload, type AuditFormInput } from "@/lib/audit-request";
import { useRouter } from "next/navigation";

type AudienceScope = "local" | "regional" | "national";

function deriveBusinessName(raw: string): string {
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "");
    const label = host.split(".")[0] || "Website";
    return label
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "Website Audit";
  }
}

export default function NewAuditPage() {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState("");
  const [competitor1, setCompetitor1] = useState("");
  const [competitor2, setCompetitor2] = useState("");
  const [competitor3, setCompetitor3] = useState("");
  const [audienceScope, setAudienceScope] = useState<AudienceScope>("local");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");

    const competitors = [competitor1, competitor2, competitor3]
      .map((value) => value.trim())
      .filter(Boolean);

    const input: AuditFormInput = {
      targetUrl,
      businessName: deriveBusinessName(targetUrl),
      market: audienceScope,
      language: "en-CA",
      competitors,
      services: [],
      primaryGoal: "",
    };

    const validation = validateAuditForm(input);
    setErrors(validation.errors);
    if (!validation.valid) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAuditPayload(input)),
      });
      const data = await response.json();
      if (!response.ok) {
        setSubmitError(data.error || "Audit creation failed");
        return;
      }
      router.push(`/audits/${data.auditId}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>New Website Audit</h1>
      <p style={{ color: "var(--muted)", marginBottom: 20 }}>
        Enter the site, optional competitors, and the audience level Prysm should evaluate against.
      </p>

      {submitError && (
        <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card">
        <div className="form-group">
          <label htmlFor="targetUrl">Website to audit *</label>
          <input
            id="targetUrl"
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com"
            autoComplete="url"
          />
          {errors.targetUrl && <p className="form-error">{errors.targetUrl}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="audienceScope">Competing audience *</label>
          <select
            id="audienceScope"
            value={audienceScope}
            onChange={(e) => setAudienceScope(e.target.value as AudienceScope)}
          >
            <option value="local">Local</option>
            <option value="regional">Regional</option>
            <option value="national">National</option>
          </select>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 6 }}>
            This sets the competitive context used by the audit.
          </p>
        </div>

        <div className="form-group">
          <label>Competitor websites <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional, up to 3)</span></label>
          <input
            type="text"
            value={competitor1}
            onChange={(e) => setCompetitor1(e.target.value)}
            placeholder="https://competitor1.com"
            style={{ marginBottom: 8 }}
          />
          <input
            type="text"
            value={competitor2}
            onChange={(e) => setCompetitor2(e.target.value)}
            placeholder="https://competitor2.com"
            style={{ marginBottom: 8 }}
          />
          <input
            type="text"
            value={competitor3}
            onChange={(e) => setCompetitor3(e.target.value)}
            placeholder="https://competitor3.com"
          />
          {errors.competitors && <p className="form-error">{errors.competitors}</p>}
          {[0, 1, 2].map((index) => errors[`competitor_${index}`] ? (
            <p className="form-error" key={index}>{errors[`competitor_${index}`]}</p>
          ) : null)}
        </div>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Starting Audit..." : "Run Audit"}
        </button>
      </form>
    </div>
  );
}
