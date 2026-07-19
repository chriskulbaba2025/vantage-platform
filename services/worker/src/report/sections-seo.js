import { e, fmtSec, scoreCard, section, table } from "./html-helpers.js";

function technical(model) {
  const site = model.evidence.site;
  const perf = model.evidence.performance;
  const first = site.pages[0];
  const status = (ok) => ok ? '<span style="color:var(--green)">Pass</span>' : '<span style="color:var(--amber)">Warning</span>';
  const card = (title, metrics, ok) => `<div class="hygiene-card"><h4>${e(title)}</h4>${metrics.map(([tag, value]) => `<div class="metric"><span class="tag">${e(tag)}</span> ${e(value)}</div>`).join("")}<p style="margin-top:8px;font-size:.75rem"><strong>Status:</strong> ${status(ok)}</p></div>`;
  return section("technical-seo-hygiene", "09", "Technical SEO Hygiene", `<p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Supporting evidence panel. [CRAWL] is captured website evidence and [PSI/LH] is performance evidence.</p><div class="hygiene-grid">${card("1. Meta Information", [["CRAWL", `Titles missing: ${site.missingTitles}`], ["CRAWL", `Meta descriptions missing: ${site.missingDescriptions}`], ["CRAWL", `Canonicals missing: ${site.missingCanonicals}`], ["CRAWL", `Crawled pages: ${site.pageCount}`]], site.missingTitles + site.missingDescriptions + site.missingCanonicals === 0)}${card("2. Page Quality", [["CRAWL", `Total words: ${site.totalWords}`], ["CRAWL", `Average words: ${site.averageWords}`], ["CRAWL", `Images missing alt: ${site.imagesMissingAlt}`], ["CRAWL", `Forms detected: ${site.forms.length}`]], site.averageWords >= 300 && site.imagesMissingAlt === 0)}${card("3. Page Structure", [["CRAWL", `H1 missing: ${site.h1Missing}`], ["CRAWL", `Multiple H1: ${site.h1Multiple}`], ["CRAWL", `Homepage H2 count: ${first?.headings?.h2?.length || 0}`], ["CRAWL", `Schema types: ${site.schemaTypes.length}`]], site.h1Missing + site.h1Multiple === 0)}${card("4. Link Structure", [["CRAWL", `Internal links: ${site.internalLinkCount}`], ["CRAWL", `Broken crawled pages: ${site.brokenInternalLinks.length}`], ["CRAWL", `External CTAs: ${site.externalCtas.length}`]], site.brokenInternalLinks.length === 0)}${card("5. Server & Security", [["CRAWL", `HTTPS: ${site.targetUrl.startsWith("https:") ? "Enabled" : "Not enabled"}`], ["CRAWL", `X-Frame-Options: ${site.securityHeaders.xFrameOptions ? "Present" : "Missing"}`], ["CRAWL", `X-Content-Type-Options: ${site.securityHeaders.xContentTypeOptions ? "Present" : "Missing"}`], ["CRAWL", `Referrer-Policy: ${site.securityHeaders.referrerPolicy ? "Present" : "Missing"}`]], Object.values(site.securityHeaders).filter(Boolean).length >= 3)}${card("6. Performance", [["PSI/LH", `Mobile: ${perf?.mobile?.scores?.performance ?? "Unavailable"}`], ["PSI/LH", `Desktop: ${perf?.desktop?.scores?.performance ?? "Unavailable"}`], ["PSI/LH", `Mobile LCP: ${fmtSec(perf?.mobile?.metrics?.lcpMs)}`], ["PSI/LH", `Mobile FCP: ${fmtSec(perf?.mobile?.metrics?.fcpMs)}`]], model.scores.performance >= 70)}</div>`);
}

function headings(model) {
  const site = model.evidence.site;
  const first = site.pages[0] || { headings: {} };
  const levels = [1, 2, 3, 4].map((level) => {
    const content = first.headings?.[`h${level}`] || [];
    const issue = level === 1 ? (content.length === 1 ? "None detected" : content.length === 0 ? "Missing" : "Multiple H1 headings") : (level > 2 && !content.length ? "None detected" : "Review sequence");
    return [`H${level}`, e(content.length), e(content.slice(0, 5).join('”, “') ? `“${content.slice(0, 5).join('”, “')}”` : "—"), e(issue)];
  });
  return section("heading-structure-and-semantic-seo", "10", "Heading Structure and Semantic SEO", `${table(["Level", "Count", "Homepage Content", "Issue"], levels)}<h3>Recommendations</h3><ul><li>Use one descriptive H1 as the first major page heading.</li><li>Use H2 for major sections and H3 for nested topics.</li><li>Keep heading levels sequential and independent from visual styling.</li><li>Use unique, descriptive headings for each service page.</li></ul>`);
}

function schema(model) {
  const site = model.evidence.site;
  const has = (name) => site.schemaTypes.some((x) => x.toLowerCase().includes(name.toLowerCase()));
  return section("schema-and-entity-trust", "11", "Schema and Entity Trust", `${table(["Signal", "Status", "Impact"], [["Structured Data", site.schemaTypes.length ? site.schemaTypes.join(", ") : "None detected", "Entity context"], ["LocalBusiness / Organization", has("LocalBusiness") || has("Organization") ? "Present" : "Missing", "Business identity"], ["Person Schema", has("Person") ? "Present" : "Missing", "Expert identity"], ["Service Schema", has("Service") ? "Present" : "Missing", "Offer clarity"], ["FAQ Schema", has("FAQ") ? "Present" : "Missing", "Question coverage"], ["HTTPS", site.targetUrl.startsWith("https:") ? "Enabled" : "Missing", "Transport trust"], ["Social Links", site.socialLinks.length ? "Present" : "Missing", "Entity corroboration"]].map((r) => r.map(e)))}<h3>Recommended Schema</h3><ul><li><strong>Organization or LocalBusiness</strong> — identity, contact, service area, and sameAs links.</li><li><strong>Person</strong> — named expert, role, description, and knowsAbout topics.</li><li><strong>Service</strong> — one entity for each primary offer.</li><li><strong>FAQPage</strong> — only where visible FAQ content exists.</li></ul>`);
}

export { technical, headings, schema };
