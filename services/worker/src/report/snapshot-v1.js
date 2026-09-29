import { normalizeBrandIdentity, verifyBrandAsset } from "../evidence/brand-assets.js";
import { isUsableName, resolveBusinessDisplayName } from "../identity/business-display-name.js";
import { renderSnapshotV1WithWhitePanel as renderSnapshotV1 } from "./snapshot-v1-reference.js";
import { buildSemanticEvidenceAuthority, isObserved } from "../report-intelligence/semantic-evidence-authority.js";

export { SNAPSHOT_V1_RENDERER_VERSION } from "./snapshot-v1-reference.js";

const STATUS = new Set(["AVAILABLE", "PARTIAL", "UNKNOWN", "UNAVAILABLE", "FAILED", "NOT_CONNECTED", "NOT_APPLICABLE"]);
const BRAD_BOOKING_URL = "https://calendly.com/brad-omnipresence/30min";

function text(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function esc(value) { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function url(value) { try { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : ""; } catch { return ""; } }
function domain(value) { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; } }
function statusOf(value) { const status = text(value).toUpperCase(); return STATUS.has(status) ? status : "UNKNOWN"; }
function available(status) { return statusOf(status) === "AVAILABLE"; }
function displayStatus(status) { return statusOf(status).replaceAll("_", " ").toLowerCase(); }
function semanticAuthority(pkg, evidence) { return pkg?.semanticEvidence || buildSemanticEvidenceAuthority(evidence); }

function friendlyFindingTitle(value) {
  const title = text(value);
  if (/largest contentful paint|\blcp\b|main content.*slow|mobile.*slow/i.test(title)) return "Your main mobile content is slow to appear";
  if (/faq/i.test(title) && /(missing|absent|not detected|unclear)/i.test(title)) return "Visitors may not find answers to common questions";
  if (/schema|structured data/i.test(title)) return "Search engines get limited extra information about your business";
  if (/meta description|meta tag|title tag/i.test(title)) return "Search listings could explain your business more clearly";
  if (/canonical|crawl|indexing|sitemap/i.test(title)) return "Important pages may be harder for search engines to understand";
  if (/alt text|image description/i.test(title)) return "Some images may not explain what they show";
  if (/broken link|internal link/i.test(title)) return "Some links may make it harder to find the next step";
  return title || "Conversion opportunity";
}

function friendlyFindingAction(value) {
  const action = text(value);
  if (/schema|structured data/i.test(action)) return "Add clear business details to the site so search engines can better understand what you offer.";
  if (/lcp|largest contentful paint|render-blocking|above[- ]the[- ]fold|page speed|performance/i.test(action)) return "Make the main page content appear sooner, especially on mobile.";
  if (/faq|frequently asked/i.test(action)) return "Add a clear FAQ that answers the questions buyers ask before reaching out.";
  if (/meta description|meta tag|title tag/i.test(action)) return "Write a clear page description that tells buyers what each page offers.";
  if (/canonical|crawl|indexing|sitemap/i.test(action)) return "Make sure important pages are easy for search engines to find and understand.";
  if (/alt text|image description/i.test(action)) return "Add helpful descriptions to important images.";
  if (/broken link|internal link/i.test(action)) return "Fix broken links and make the next step easy to follow.";
  return action || "Make the next step clearer on the affected page.";
}

function friendlyEvidence(item = {}) {
  const field = text(item.field).toLowerCase();
  const value = item.observedValue;
  if (field.includes("lcp") || field.includes("largest contentful paint")) {
    const milliseconds = Number(value);
    if (Number.isFinite(milliseconds) && milliseconds > 0) return `Your main mobile content takes about ${(milliseconds / 1000).toFixed(1)} seconds to appear.`;
    return "Mobile loading information was limited for this review.";
  }
  if (field.includes("faq")) {
    if (value === false) return "We could not find a clear FAQ section answering common buyer questions.";
    if (value === true) return "A clear FAQ section was found to help answer common buyer questions.";
    return "Information about buyer questions was limited for this review.";
  }
  if (field.includes("schema") || field.includes("structured")) {
    const hasDetails = Array.isArray(value) ? value.length > 0 : Boolean(value);
    return hasDetails ? "Search engines receive extra information about this business." : "Search engines are getting limited extra information about this business.";
  }
  if (field.includes("cta") || field.includes("contact") || field.includes("booking")) {
    return value ? "A way for visitors to take the next step was found." : "The next step for visitors could be clearer.";
  }
  if (value == null) return "Some information for this opportunity was limited in this review.";
  if (typeof value === "boolean") return value ? "This site signal was found in the review." : "This site signal was not found in the review.";
  return "The review found a site detail that may make the next step harder to understand.";
}

function buildSignals(pkg, evidence) {
  const site = evidence.site || {};
  const authority = semanticAuthority(pkg, evidence);
  const signals = [];
  const services = Array.isArray(pkg?.siteMetrics?.services) ? pkg.siteMetrics.services.filter(Boolean) : (site.services || []).filter(Boolean);
  if (services.length) signals.push({ label: "Core services", value: String(services.length) });
  const ctas = Array.isArray(site.ctas) ? site.ctas : [];
  const ctaText = ctas.map((item) => item.text || "").join(" ");
  if (ctas.length) signals.push({ label: "Conversion paths", value: `${ctas.length} observed` });
  if (/book|schedule|appointment|quote|estimate|request/i.test(ctaText)) signals.push({ label: "Next-step signal", value: "Observed" });
  if (isObserved(authority, "TESTIMONIAL_OR_REVIEW")) signals.push({ label: "Review evidence", value: "Observed" });
  if (isObserved(authority, "FORMAL_CREDENTIAL")) signals.push({ label: "Credentials", value: "Observed" });
  if (site.trust?.faq === true) signals.push({ label: "Buyer questions", value: "Observed" });
  return signals.slice(0, 5);
}

function buildMetricSignals(pkg, evidence) {
  const site = evidence.site || {};
  const authority = semanticAuthority(pkg, evidence);
  const services = Array.isArray(pkg?.siteMetrics?.services) ? pkg.siteMetrics.services.filter(Boolean) : [];
  const ctas = Array.isArray(site.ctas) ? site.ctas.filter(Boolean) : [];
  const metrics = [];
  if (services.length) metrics.push({ value: `${services.length} service${services.length === 1 ? "" : "s"}`, detail: services.slice(0, 4).join(", ") });
  if (ctas.length) metrics.push({ value: `${ctas.length} conversion path${ctas.length === 1 ? "" : "s"}`, detail: "Ways for visitors to take action were found" });
  if (site.trust?.contact === true) metrics.push({ value: "Contact option", detail: "Contact information was found" });
  if (isObserved(authority, "TESTIMONIAL_OR_REVIEW") || isObserved(authority, "FORMAL_CREDENTIAL") || isObserved(authority, "OPERATING_EXPERIENCE")) metrics.push({ value: "Trust proof", detail: "Reviews or classified experience proof was found" });
  if (site.trust?.pricing === true) metrics.push({ value: "Pricing context", detail: "Pricing information was found" });
  if (!metrics.length) metrics.push({ value: "Limited site signals", detail: "Some useful site information was not available" });
  return metrics.slice(0, 4);
}

function supportedFinding(finding) {
  const statuses = (finding.evidence || []).map((item) => item.status || item.sourceStatus || item._evidenceStatus).filter(Boolean);
  return !statuses.length || statuses.some((status) => ["AVAILABLE", "PARTIAL"].includes(statusOf(status)));
}

function buildFindings(pkg) {
  const findingById = new Map((Array.isArray(pkg?.findings) ? pkg.findings : []).map((finding) => [finding.findingId, finding]));
  const decisions = Array.isArray(pkg?.canonicalDecisionModel?.decisions) ? pkg.canonicalDecisionModel.decisions : [];
  return decisions
    .filter((decision) => decision.scoreBearing === true)
    .map((decision) => ({ decision, finding: findingById.get(decision.findingId) }))
    .filter(({ decision, finding }) => finding && supportedFinding({ ...finding, evidence: decision.evidence || finding.evidence }))
    .slice(0, 3)
    .map(({ decision, finding }) => ({
    canonicalFindingId: decision.findingId,
    priority: decision.rank,
    evidenceStatus: decision.evidenceStatus?.[0] || "UNKNOWN",
    title: friendlyFindingTitle(decision.title || finding.title),
    where: text(finding.affectedUrls?.[0]) || "Assessed site",
    value: text(decision.severity || finding.severity) || "Supported finding",
    evidence: (decision.evidence || finding.evidence || []).slice(0, 1).map((item) => friendlyEvidence(item)).join(" ") || "The review found a site detail worth improving.",
    why: text(decision.businessImpact || finding.businessImpact) || "This may make the next step harder for visitors to understand.",
    action: friendlyFindingAction(decision.recommendation || finding.recommendation),
  }));
}

function buildStrengths(evidence) {
  const site = evidence.site || {};
  const authority = semanticAuthority(null, evidence);
  const items = [];
  if (site.trust?.contact === true) items.push("Contact information is visible in the assessed evidence.");
  if (isObserved(authority, "TESTIMONIAL_OR_REVIEW")) items.push("Review or testimonial language is present in the assessed evidence.");
  if (isObserved(authority, "FORMAL_CREDENTIAL") || isObserved(authority, "OPERATING_EXPERIENCE")) items.push("Classified credential or experience proof is present in the assessed evidence.");
  if (site.trust?.faq === true) items.push("Buyer-question content is present in the assessed evidence.");
  if ((site.ctas || []).length) items.push("A conversion action was observed in the assessed pages.");
  return [...new Set(items)].slice(0, 3);
}

function buildChecked(evidence, pkg) {
  const status = pkg?.sourceStatus || {};
  const checked = [];
  if (status.website || evidence.site) checked.push("homepage and assessed pages");
  if ((evidence.site?.ctas || []).length || (evidence.site?.forms || []).length) checked.push("conversion paths");
  if ((evidence.site?.services || []).length) checked.push("service pages");
  if (evidence.site?.trust) checked.push("trust signals");
  if (status.performance && status.performance !== "NOT_CONNECTED") checked.push("technical performance");
  if (Array.isArray(pkg?.competitors) && pkg.competitors.some((item) => available(item.status))) checked.push("competitor evidence");
  return [...new Set(checked)].slice(0, 6);
}

export function buildSnapshotV1Projection({ auditRequest = {}, canonicalEvidence = {}, reportContentPackage = {}, reviewDate = null, ctaConfig = {} } = {}) {
  const site = canonicalEvidence.site || {};
  const canonicalDomain = text(reportContentPackage.business?.domain || site.domain || domain(auditRequest.targetUrl));
  const persistedName = text(reportContentPackage.business?.name);
  const businessName = text(isUsableName(persistedName, canonicalDomain) ? persistedName : resolveBusinessDisplayName(auditRequest, site) || "Assessed business");
  const persistedBrand = site.brandIdentity?.logo
    ? { ...site.brandIdentity, logo: verifyBrandAsset(site.brandIdentity.logo, { canonicalDomain, businessName }) }
    : null;
  const brand = persistedBrand || normalizeBrandIdentity({ candidates: site.pages?.flatMap((page) => page.brandAssetCandidates || []) || [], canonicalDomain, businessName });
  const findings = buildFindings(reportContentPackage);
  const semanticEvidence = semanticAuthority(reportContentPackage, canonicalEvidence);
  const competitors = (reportContentPackage.competitors || []).filter((item) => available(item.status) && url(item.url)).slice(0, 3);
  const configuredCta = url(ctaConfig.ctaUrl || ctaConfig.bookingUrl);
  const metricSignals = buildMetricSignals(reportContentPackage, canonicalEvidence);
  const teaserCounts = [
    `${findings.length} priority conversion finding${findings.length === 1 ? "" : "s"} already surfaced`,
    reportContentPackage.siteMetrics?.services?.length ? `${reportContentPackage.siteMetrics.services.length} service paths reviewed` : "Service information was limited",
    (site.ctas || []).length ? `${site.ctas.length} direct action${site.ctas.length === 1 ? "" : "s"} found` : "Booking details were not available",
  ];
  return {
    product: "PRYSM Snapshot",
    title: "Snapshot · Conversion Readiness",
    businessName,
    canonicalDomain,
    market: auditRequest.market && site.marketEvidenceStatus === "AVAILABLE" ? text(auditRequest.market) : "",
    reviewDate: text(reviewDate || site.collectedAt || new Date().toISOString()).slice(0, 10),
    brand,
    score: reportContentPackage.showNumericScore !== false && reportContentPackage.scores?.conversionReadiness != null ? reportContentPackage.scores.conversionReadiness : null,
    scoreBand: /evidence-limited/i.test(text(reportContentPackage.bands?.conversionReadiness)) ? "Limited information" : text(reportContentPackage.bands?.conversionReadiness || "Not assessed"),
    scoreBreakdown: [
      ["Trust", reportContentPackage.scores?.trust],
      ["Clarity", reportContentPackage.scores?.contentDepth],
      ["Path", reportContentPackage.scores?.conversionPathways],
    ].filter(([, value]) => Number.isFinite(value)).map(([label, value]) => ({ label, value })),
    summary: reportContentPackage.scores?.conversionReadiness == null ? "There was not enough information to give your site a readiness score." : ((site.ctas || []).length ? "Your site gives visitors several ways to take the next step, but the main action could be clearer. Making that choice easier to understand may help more visitors move forward." : "Your website has useful information, but the next step for a visitor is not always easy to see. Making that choice clearer could help more people move forward."),
    readoutDetail: reportContentPackage.limitations?.length ? "Some parts of this review were limited, so this Snapshot focuses on what we could see clearly." : "We looked at the parts of the site that shape a visitor’s next step, including services, trust, and contact actions.",
    semanticEvidence,
    metricSignals,
    signals: buildSignals(reportContentPackage, canonicalEvidence),
    findings,
    competitor: competitors.length ? { domain: competitors[0].domain || domain(competitors[0].url), status: "AVAILABLE" } : null,
    currentAction: text(site.ctas?.[0]?.text || "Observed conversion action"),
    oneFix: findings[0]?.action || "Use the clearest supported next step earlier on the page.",
    strengths: buildStrengths(canonicalEvidence),
    checked: buildChecked(canonicalEvidence, reportContentPackage),
    limitations: (reportContentPackage.limitations || []).slice(0, 3),
    teaserCounts,
    cta: configuredCta ? { url: BRAD_BOOKING_URL, enabled: true } : { url: null, enabled: false },
    ctaIdentity: { name: "Brad Grant", role: "CEO & Co-Founder, Omnipressence" },
    evidenceUsed: {
      business: `${businessName}: main website pages, service descriptions, trust signals, and the ways visitors can take action.`,
      competitors: competitors.length ? "We also reviewed the competitor information available for this review." : "No competitor information was available for this review.",
      limitation: competitors.length ? "Only the competitor details available in the reviewed pages are included here." : "The Snapshot stays focused on the site information available for this review.",
    },
  };
}

const CSS = `<style>@page{size:letter;margin:0}*{box-sizing:border-box}body{margin:0;background:#e9edf2;color:#172235;font-family:Arial,sans-serif}.snapshot-page{width:8.5in;height:11in;overflow:hidden;margin:0 auto;background:#fff;padding:.34in .42in;position:relative;font-size:9px;line-height:1.3}.mast{display:flex;justify-content:space-between;border-bottom:2px solid #162c4f;padding-bottom:10px}.brand{font-weight:800;font-size:17px;color:#162c4f}.kicker{font-size:10px;color:#2d6f78;font-weight:700}.identity{text-align:right}.identity strong{font-size:14px;display:block}.identity small{color:#5d6979}.logo{width:44px;height:34px;object-fit:contain;vertical-align:middle;margin-left:8px}.grid{display:grid;grid-template-columns:1fr 1.24fr;gap:12px;margin-top:11px}.card{border:1px solid #d8dee7;border-radius:7px;padding:9px;margin-bottom:9px}.card h2{font-size:11px;margin:0 0 6px;color:#162c4f}.score{font-size:30px;font-weight:800;color:#2d6f78}.score span{font-size:10px;font-weight:600;color:#5d6979}.signals{display:flex;gap:5px;flex-wrap:wrap}.signal{background:#eef5f4;border-radius:5px;padding:5px 7px}.signal b{display:block;font-size:12px;color:#162c4f}.finding{border-left:3px solid #2d6f78;padding-left:7px;margin:0 0 9px}.finding h3{margin:0;font-size:10px}.finding p{margin:3px 0}.muted{color:#5d6979}.tag{display:inline-block;background:#edf0f5;border-radius:9px;padding:2px 6px;margin-right:4px;font-size:8px}.cta{background:#162c4f;color:white;border-radius:7px;padding:9px}.cta a{color:white;font-weight:700}.bridge{background:#f0f6f5;border:1px solid #b9d5d2}.bridge h2{color:#1f5f66}.locked{color:#647184;border-top:1px solid #c9d5d7;padding-top:4px;margin-top:5px}.footer{position:absolute;bottom:.25in;left:.42in;right:.42in;border-top:1px solid #d8dee7;padding-top:5px;color:#6a7482;font-size:8px;display:flex;justify-content:space-between}.no-logo{font-size:13px;font-weight:800;color:#162c4f;display:inline-block;margin-left:8px}.compact{margin:0;padding-left:15px}.compact li{margin:2px 0}@media print{body{background:#fff}.snapshot-page{margin:0}}</style>`;

function renderSnapshotV1LegacyDocument(projection) {
  const p = projection;
  const logo = p.brand?.logo?.verified && url(p.brand.logo.url) ? `<img class="logo" src="${esc(p.brand.logo.url)}" alt="${esc(p.businessName)} logo">` : `<span class="no-logo">${esc(p.businessName)}</span>`;
  const score = p.score == null ? `<div class="score">— <span>not available</span></div>` : `<div class="score">${esc(p.score)}<span>/100 · ${esc(p.scoreBand)}</span></div>`;
  const findings = p.findings.length ? p.findings.map((f) => `<article class="finding"><h3>${f.priority}. ${esc(f.title)} <span class="tag">${esc(f.value)}</span></h3><p class="muted">${esc(f.where)}</p><p><b>Evidence:</b> ${esc(f.evidence)}</p><p><b>Why it matters:</b> ${esc(f.why)}</p><p><b>Action:</b> ${esc(f.action)}</p></article>`).join("") : `<p class="muted">The persisted evidence does not support a ranked opportunity here.</p>`;
  const competitor = p.competitor ? `<div class="card"><h2>Competitive Signal</h2><p>Direct competitor evidence was available for <b>${esc(p.competitor.domain)}</b>.</p></div>` : "";
  const signals = p.signals.length ? p.signals.map((s) => `<div class="signal"><b>${esc(s.value)}</b>${esc(s.label)}</div>`).join("") : `<span class="muted">No additional site signals were available.</span>`;
  const strengths = p.strengths.length ? `<ul class="compact">${p.strengths.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p class="muted">No additional strengths were supported by the persisted evidence.</p>`;
  const checked = p.checked.length ? p.checked.map((item) => `<span class="tag">${esc(item)}</span>`).join("") : `<span class="muted">No connected evidence categories</span>`;
  const cta = p.cta.enabled ? `<a href="${esc(p.cta.url)}">Book a conversation</a>` : `<span>Conversation link is not configured.</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(p.businessName)} — PRYSM Snapshot</title>${CSS}</head><body><main class="snapshot-page"><header class="mast"><div><div class="brand">PRYSM</div><div class="kicker">${esc(p.title)}</div></div><div class="identity"><strong>${esc(p.businessName)} ${logo}</strong><small>${esc(p.canonicalDomain)}${p.market ? ` · ${esc(p.market)}` : ""} · Reviewed ${esc(p.reviewDate)}</small></div></header><div class="grid"><div><section class="card"><h2>Conversion Readiness Summary</h2>${score}<p>${esc(p.summary)}</p></section><section class="card"><h2>Quick Site Signals</h2><div class="signals">${signals}</div></section><section class="card"><h2>One Fix You Can Use Now</h2><p><b>Current → stronger option</b></p><p>${esc(p.oneFix)}</p></section><section class="card"><h2>What Is Already Helping</h2>${strengths}</section><section class="cta"><b>Omnipressence</b><br>${esc(p.ctaIdentity.name)} · ${esc(p.ctaIdentity.role)}<p>Brad helps businesses turn customer and business insight into clearer, repeatable action.</p>${cta}</section></div><div><section class="card"><h2>Top Conversion Opportunities</h2>${findings}</section>${competitor}<section class="card bridge"><h2>PRYSM Executive Audit</h2><p><b>7-page full conversion analysis</b></p><p>Expand into the customer journey, trust and credibility, competitor gaps, content opportunities, technical barriers, and a prioritized roadmap.</p><p>${p.teaserCounts.map((item) => `<span class="tag">${esc(item)}</span>`).join("")}</p><div class="locked">Customer journey · Trust gaps · Competitor gaps · Content opportunities · Priority roadmap</div></section><section class="card"><h2>What PRYSM Checked</h2><p>${checked}</p><p><b>The Executive Audit unlocks</b></p><ul class="compact"><li>Full customer journey map</li><li>Competitor gap analysis</li><li>Content opportunity set</li><li>Priority roadmap</li></ul>${p.limitations.length ? `<p class="muted">Evidence limits: ${esc(p.limitations.join("; "))}</p>` : ""}</section></div></div><footer class="footer"><span>PRYSM Snapshot · Conversion Readiness</span><span>Omnipressence</span></footer></main></body></html>`;
}

export function renderSnapshotV1Legacy(projection) {
  return renderSnapshotV1LegacyDocument(projection)
    .replaceAll("Omnipresence", "Omnipressence")
    .replaceAll("technical barriers", "site barriers")
    .replaceAll("technical performance", "site performance")
    .replaceAll("persisted evidence", "information reviewed")
    .replaceAll("governed evidence", "site information")
    .replaceAll("supported service signal already present in the audit evidence", "service information found during the review")
    .replace(/Evidence limits:[^<]*/g, "Some review information was limited.")
    .replace(/href="https:\/\/calendly\.com\/[^\"]*"/g, 'href="https://calendly.com/brad-omnipresence/30min"');
}

export { renderSnapshotV1 };
export default { buildSnapshotV1Projection, renderSnapshotV1 };
