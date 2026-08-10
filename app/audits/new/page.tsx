"use client";

import { useState } from "react";
import { validateAuditForm, buildAuditPayload, type AuditFormInput } from "@/lib/audit-request";
import { useRouter } from "next/navigation";

export default function NewAuditPage() {
  const router = useRouter();
  const [form, setForm] = useState<Partial<AuditFormInput>>({
    targetUrl: "",
    businessName: "",
    market: "",
    language: "en-CA",
    primaryGoal: "",
    services: [],
    competitors: [],
    ga4PropertyId: "",
    gscSiteUrl: "",
  });
  const [servicesText, setServicesText] = useState("");
  const [competitor1, setCompetitor1] = useState("");
  const [competitor2, setCompetitor2] = useState("");
  const [competitor3, setCompetitor3] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");

    // Build competitors from individual fields
    const competitors = [competitor1, competitor2, competitor3].filter((c) => c.trim());
    const services = servicesText.split(",").map((s) => s.trim()).filter(Boolean);

    const input: AuditFormInput = {
      ...form as AuditFormInput,
      services,
      competitors,
    };

    const validation = validateAuditForm(input);
    setErrors(validation.errors);
    if (!validation.valid) return;

    setSubmitting(true);
    try {
      const payload = buildAuditPayload(input);
      const res = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "Audit creation failed");
        return;
      }
      // Redirect to audit status page
      router.push(`/audits/${data.auditId}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>New Website Audit</h1>

      {submitError && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{submitError}</div>}

      <form onSubmit={handleSubmit} className="card">
        <div className="form-group">
          <label htmlFor="targetUrl">Website URL *</label>
          <input id="targetUrl" type="text" value={form.targetUrl} onChange={(e) => setForm({ ...form, targetUrl: e.target.value })} placeholder="https://example.com" />
          {errors.targetUrl && <p className="form-error">{errors.targetUrl}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="businessName">Business Name *</label>
          <input id="businessName" type="text" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Acme Inc." />
          {errors.businessName && <p className="form-error">{errors.businessName}</p>}
        </div>

        <div className="flex-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="market">Market / Location</label>
            <input id="market" type="text" value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })} placeholder="Toronto, Ontario" />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="language">Language</label>
            <select id="language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
              <option value="en-CA">English (Canada)</option>
              <option value="en-US">English (US)</option>
              <option value="fr-CA">French (Canada)</option>
              <option value="es">Spanish</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="primaryGoal">Primary Goal</label>
          <input id="primaryGoal" type="text" value={form.primaryGoal} onChange={(e) => setForm({ ...form, primaryGoal: e.target.value })} placeholder="Generate more qualified leads" />
        </div>

        <div className="form-group">
          <label htmlFor="services">Services / Offers (comma-separated)</label>
          <input id="services" type="text" value={servicesText} onChange={(e) => setServicesText(e.target.value)} placeholder="Web Design, SEO, Consulting" />
        </div>

        <div className="form-group">
          <label>Competitor URLs (up to 3)</label>
          <input type="text" value={competitor1} onChange={(e) => setCompetitor1(e.target.value)} placeholder="https://competitor1.com" style={{ marginBottom: 4 }} />
          <input type="text" value={competitor2} onChange={(e) => setCompetitor2(e.target.value)} placeholder="https://competitor2.com" style={{ marginBottom: 4 }} />
          <input type="text" value={competitor3} onChange={(e) => setCompetitor3(e.target.value)} placeholder="https://competitor3.com" />
          {errors.competitors && <p className="form-error">{errors.competitors}</p>}
        </div>

        <details style={{ marginBottom: 16 }}>
          <summary style={{ fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" }}>Analytics (Optional)</summary>
          <div className="flex-row" style={{ marginTop: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="ga4">GA4 Property ID</label>
              <input id="ga4" type="text" value={form.ga4PropertyId} onChange={(e) => setForm({ ...form, ga4PropertyId: e.target.value })} placeholder="123456789" />
              {errors.ga4PropertyId && <p className="form-error">{errors.ga4PropertyId}</p>}
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="gsc">GSC Site URL</label>
              <input id="gsc" type="text" value={form.gscSiteUrl} onChange={(e) => setForm({ ...form, gscSiteUrl: e.target.value })} placeholder="sc-domain:example.com" />
              {errors.gscSiteUrl && <p className="form-error">{errors.gscSiteUrl}</p>}
            </div>
          </div>
        </details>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Creating Audit..." : "Start Audit"}
        </button>
      </form>
    </div>
  );
}
