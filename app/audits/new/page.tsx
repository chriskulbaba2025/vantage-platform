"use client";

import { useState } from "react";
import { validateAuditForm, buildAuditPayload, type AuditFormInput } from "@/lib/audit-request";
import { useRouter } from "next/navigation";

type AudienceScope = "local" | "regional" | "national";

const GOAL_OPTIONS = [
  "Generate qualified enquiries",
  "Book appointments or consultations",
  "Sell products online",
  "Grow newsletter or lead database",
  "Other",
];

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

function parseServices(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export default function NewAuditPage() {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [market, setMarket] = useState("");
  const [competitor1, setCompetitor1] = useState("");
  const [competitor2, setCompetitor2] = useState("");
  const [competitor3, setCompetitor3] = useState("");
  const [audienceScope, setAudienceScope] = useState<AudienceScope>("local");
  const [servicesRaw, setServicesRaw] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState(GOAL_OPTIONS[0]);
  const [customGoal, setCustomGoal] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function handleTargetUrlChange(value: string) {
    setTargetUrl(value);
    if (!businessName.trim()) {
      setBusinessName(deriveBusinessName(value));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");

    const competitors = [competitor1, competitor2, competitor3]
      .map((value) => value.trim())
      .filter(Boolean);
    const goal =
      primaryGoal === "Other" ? customGoal.trim() : primaryGoal;

    const input: AuditFormInput = {
      targetUrl,
      businessName: businessName.trim() || deriveBusinessName(targetUrl),
      market: market.trim() || audienceScope,
      language: "en-CA",
      competitors,
      services: parseServices(servicesRaw),
      primaryGoal: goal || "Generate qualified enquiries",
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
        Describe the business context so Prysm assesses conversion readiness
        against the right audience, offers, and goal — not generic website
        patterns.
      </p>

      {submitError && (
        <div className="card" role="alert" style={{ borderColor: "var(--red)", color: "var(--red)" }}>
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card" aria-label="New audit intake">
        <div className="form-group">
          <label htmlFor="targetUrl">Website to audit *</label>
          <input
            id="targetUrl"
            type="text"
            value={targetUrl}
            onChange={(e) => handleTargetUrlChange(e.target.value)}
            placeholder="https://example.com"
            autoComplete="url"
            aria-required="true"
          />
          {errors.targetUrl && <p className="form-error">{errors.targetUrl}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="businessName">Business name *</label>
          <input
            id="businessName"
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Derived from the website address"
            aria-required="true"
          />
          {errors.businessName && <p className="form-error">{errors.businessName}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="services">Primary services or offers <span style={{ color: "var(--muted)", fontWeight: 400 }}>(comma-separated, up to 20)</span></label>
          <input
            id="services"
            type="text"
            value={servicesRaw}
            onChange={(e) => setServicesRaw(e.target.value)}
            placeholder="Consulting, Executive Coaching, Workshops"
          />
          {errors.services && <p className="form-error">{errors.services}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="primaryGoal">Primary conversion goal *</label>
          <select
            id="primaryGoal"
            value={primaryGoal}
            onChange={(e) => setPrimaryGoal(e.target.value)}
          >
            {GOAL_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          {primaryGoal === "Other" && (
            <input
              type="text"
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
              placeholder="Describe the primary conversion goal"
              style={{ marginTop: 8 }}
              aria-label="Custom conversion goal"
            />
          )}
        </div>

        <div className="form-group">
          <label htmlFor="market">Market or location *</label>
          <input
            id="market"
            type="text"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="e.g. Toronto, Ontario (or a region/country)"
          />
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 6 }}>
            Leave blank to use the competing-audience scope below.
          </p>
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
        </div>

        <div className="form-group">
          <label htmlFor="competitor1">Competitor websites <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional, up to 3)</span></label>
          <input
            id="competitor1"
            type="text"
            value={competitor1}
            onChange={(e) => setCompetitor1(e.target.value)}
            placeholder="https://competitor1.com"
            style={{ marginBottom: 8 }}
          />
          <input
            id="competitor2"
            type="text"
            value={competitor2}
            onChange={(e) => setCompetitor2(e.target.value)}
            placeholder="https://competitor2.com"
            aria-label="Competitor website 2"
            style={{ marginBottom: 8 }}
          />
          <input
            id="competitor3"
            type="text"
            value={competitor3}
            onChange={(e) => setCompetitor3(e.target.value)}
            placeholder="https://competitor3.com"
            aria-label="Competitor website 3"
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
