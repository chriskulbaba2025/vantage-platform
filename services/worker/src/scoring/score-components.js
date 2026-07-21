import { average, clamp } from "../utils.js";

const severityRank = { High: 3, Medium: 2, Low: 1 };

function band(score) {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Limited";
  return "Weak";
}

function confidenceBand(score) {
  if (score >= 85) return "High";
  if (score >= 65) return "Moderate";
  if (score >= 45) return "Limited";
  return "Directional";
}

function scoreTrust(site) {
  return clamp(
    (site.trust.credentials ? 25 : 0) +
    (site.trust.testimonials ? 25 : 0) +
    (site.trust.caseStudies ? 20 : 0) +
    (site.trust.policies ? 10 : 0) +
    (site.trust.contact ? 10 : 0) +
    (site.socialLinks.length ? 10 : 0),
  );
}

function scoreContent(site) {
  const pages = Math.min(30, site.pageCount * 5);
  const depth = Math.min(25, site.averageWords / 20);
  const services = Math.min(20, site.services.length * 4);
  const education = (site.trust.faq ? 15 : 0) + (site.pageCount >= 5 ? 10 : 0);
  return clamp(pages + depth + services + education);
}

function scoreConversion(site) {
  const ctaScore = Math.min(25, site.ctas.length * 5);
  const forms = site.forms.length ? 20 : 0;
  const pricing = site.trust.pricing ? 15 : 0;
  const reassurance = (site.trust.policies ? 10 : 0) + (site.trust.testimonials ? 10 : 0);
  const contact = site.trust.contact ? 10 : 0;
  const hierarchy = site.ctas.length > 0 && site.ctas.length <= 8 ? 10 : 3;
  return clamp(ctaScore + forms + pricing + reassurance + contact + hierarchy);
}

function scoreTechnical(site) {
  const pageCount = Math.max(1, site.pageCount);
  const title = 15 * (1 - site.missingTitles / pageCount);
  const meta = 15 * (1 - site.missingDescriptions / pageCount);
  const canonical = 10 * (1 - site.missingCanonicals / pageCount);
  const h1 = 15 * (1 - Math.min(pageCount, site.h1Missing + site.h1Multiple) / pageCount);
  const schema = site.schemaTypes.filter((x) => x !== "InvalidJSONLD").length ? 15 : 0;
  const image = site.imageCount ? 10 * (1 - site.imagesMissingAlt / site.imageCount) : 10;
  const security = 20 * (Object.values(site.securityHeaders).filter(Boolean).length / 4);
  return clamp(title + meta + canonical + h1 + schema + image + security);
}

function scorePerformance(performance) {
  const mobile = performance?.mobile?.scores?.performance;
  const desktop = performance?.desktop?.scores?.performance;
  const avg = average([mobile, desktop]);
  // Return null when no numeric performance result exists (e.g. PageSpeed
  // returned 429 and local Lighthouse also failed).  When a numeric average
  // is available it is clamped to 0–100 to match the original protection.
  return avg === null ? null : clamp(avg);
}

function buildFindings(site, performance) {
  const findings = [];
  const add = (severity, problem, evidence, impact, fix, effort, key) => findings.push({ severity, problem, evidence, impact, fix, effort, key });
  if (!site.trust.testimonials && !site.trust.caseStudies && !site.trust.credentials) add("High", "No visible trust proof", "No testimonials, case studies, or credentials detected", "Visitors cannot verify credibility before deciding", "Add credentials, client proof, and outcome-based case studies", "M", "trust");
  if (site.missingDescriptions) add("High", "Missing meta descriptions", `${site.missingDescriptions} of ${site.pageCount} crawled pages`, "Search listings may fail to communicate value clearly", "Write a unique 150–160 character description for each important page", "L", "meta");
  if (!site.schemaTypes.length) add("High", "No structured data detected", "No JSON-LD schema types found", "Search and AI systems receive weak entity context", "Add Organization or LocalBusiness, Person, Service, and FAQ schema where supported", "M", "schema");
  const lcp = performance?.mobile?.metrics?.lcpMs;
  if (Number.isFinite(lcp) && lcp > 4000) add("High", "Mobile largest contentful paint is slow", `${(lcp / 1000).toFixed(1)} seconds`, "Slow first impressions increase mobile abandonment", "Optimize the largest above-the-fold asset and remove render-blocking work", "M", "lcp");
  if (site.pageCount <= 1 || site.services.length > site.pageCount * 2) add("Medium", "Services lack dedicated page depth", `${site.pageCount} crawlable page(s) for ${site.services.length || "multiple"} service topics`, "Individual offers cannot build enough relevance or answer buyer questions", "Create one focused page for each primary service", "H", "pages");
  if (site.h1Missing || site.h1Multiple) add("Medium", "Heading structure is inconsistent", `${site.h1Missing} pages missing H1; ${site.h1Multiple} pages with multiple H1s`, "Semantic clarity and accessibility are reduced", "Use one descriptive H1 per page with sequential H2 and H3 sections", "M", "headings");
  const missingSecurity = Object.entries(site.securityHeaders).filter(([, present]) => !present).map(([name]) => name);
  if (missingSecurity.length) add("Medium", "Security headers are incomplete", missingSecurity.join(", "), "Missing browser protections can weaken technical trust", "Configure the missing response headers at the hosting layer", "L", "security");
  if (!site.trust.faq) add("Medium", "No buyer-question content detected", "No FAQ or common-question section found", "Unanswered objections can stop conversion", "Add an FAQ based on the questions prospects ask before booking", "M", "faq");
  if (!site.trust.pricing) add("Medium", "Pricing or investment context is absent", "No pricing, cost, fee, or investment language detected", "Visitors may leave before contacting because commitment is unclear", "State pricing, starting price, or the process used to determine cost", "L", "pricing");
  if (site.imagesMissingAlt) add("Low", "Images are missing alternative text", `${site.imagesMissingAlt} of ${site.imageCount} images`, "Accessibility and image understanding are reduced", "Add concise descriptive alt text to meaningful images", "L", "alt");
  if (site.imagesMissingDimensions) add("Low", "Images lack explicit dimensions", `${site.imagesMissingDimensions} of ${site.imageCount} images`, "Layout shifts can reduce visual stability", "Set width and height on rendered images", "L", "dimensions");
  return findings.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]).slice(0, 10);
}

export { band, confidenceBand, scoreTrust, scoreContent, scoreConversion, scoreTechnical, scorePerformance, buildFindings };
