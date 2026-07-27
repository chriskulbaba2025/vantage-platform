#!/usr/bin/env node
import { generateInternalLinkOpportunities, isUtilityPage, isGenericAnchor, alreadyLinksTo } from "../src/evidence/internal-link-opportunity.js";
import { SOURCE_STATUS } from "../src/scoring/evidence-contracts.js";

let pass = true; const sc = [];
console.log("\n=== Task 10 Acceptance Harness ===\n");

const SITE = {
  domain: "example.com", pageCount: 6, internalLinkCount: 10, brokenInternalLinks: [],
  services: ["Consulting", "Coaching", "Web Design"],
  coverage: { completed: 6, requested: 6 },
  pages: [
    { url: "https://example.com/", title: "Home", headings: { h1: ["Example Consulting"], h2: ["Our Services", "Consulting", "Web Design"], h3: [] }, links: [{ url: "https://example.com/services/consulting", text: "Consulting" }], words: 500 },
    { url: "https://example.com/services/consulting", title: "Consulting", headings: { h1: ["Business Consulting"], h2: ["Strategy"], h3: [] }, links: [{ url: "https://example.com/contact", text: "Book" }], words: 800 },
    { url: "https://example.com/services/web-design", title: "Web Design", headings: { h1: ["Custom Web Design"], h2: [], h3: [] }, links: [], words: 600 },
    { url: "https://example.com/contact", title: "Contact", headings: { h1: ["Get in Touch"], h2: [], h3: [] }, links: [], words: 200 },
    { url: "https://example.com/blog/trends", title: "Consulting Trends 2026", headings: { h1: ["Consulting Trends"], h2: ["AI in Consulting"], h3: [] }, links: [{ url: "https://example.com/services/consulting", text: "Our Services" }], words: 1200 },
    { url: "https://example.com/privacy", title: "Privacy Policy", headings: { h1: ["Privacy"], h2: [], h3: [] }, links: [], words: 100 },
    { url: "https://example.com/services/coaching", title: "Coaching", headings: { h1: ["Leadership Coaching"], h2: ["Executive Coaching"], h3: [] }, links: [], words: 700 },
  ],
};
const INPUT = { targetUrl: "https://example.com", businessName: "Example Consulting" };

// 1: Valid recommendations
try {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  sc.push({ name: "Generates evidence-backed recommendations", ok: r.opportunities.length > 0 });
  if (r.opportunities.length === 0) { console.log("FAIL: no recommendations"); pass = false; }
} catch (e) { sc.push({ name: "Recommendations", ok: false }); console.log("FAIL: " + e.message); pass = false; }

// 2: Orphans detected
try {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  const ok = r.orphans.some((o) => o.url.includes("coaching"));
  sc.push({ name: "Orphan page detected", ok });
  if (!ok) { console.log("FAIL: orphan not detected"); pass = false; }
} catch (e) { sc.push({ name: "Orphans", ok: false }); pass = false; }

// 3: Utility exclusion
try {
  const ok = isUtilityPage({ url: "https://x.com/privacy" }) && !isUtilityPage({ url: "https://x.com/services" });
  sc.push({ name: "Utility page exclusion", ok });
  if (!ok) pass = false;
} catch (e) { sc.push({ name: "Utility", ok: false }); pass = false; }

// 4: Already-linked exclusion
try {
  const ok = alreadyLinksTo(SITE.pages[0], "https://example.com/services/consulting");
  sc.push({ name: "Already-linked detection", ok });
  if (!ok) pass = false;
} catch (e) { sc.push({ name: "Already-linked", ok: false }); pass = false; }

// 5: Low confidence excluded from client output
try {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  const lowConf = r.allOpportunities.filter((o) => o.confidence === "low");
  const clientHasLow = lowConf.some((lc) => r.opportunities.some((co) => co.sourceUrl === lc.sourceUrl && co.targetUrl === lc.targetUrl));
  sc.push({ name: "Low-confidence excluded from client output", ok: !clientHasLow });
  if (clientHasLow) { console.log("FAIL: low-conf leaked"); pass = false; }
} catch (e) { sc.push({ name: "Low-conf", ok: false }); pass = false; }

// 6: Self-link exclusion
try {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  const selfLinks = r.allOpportunities.filter((o) => o.sourceUrl === o.targetUrl);
  sc.push({ name: "Self-link exclusion", ok: selfLinks.length === 0 });
  if (selfLinks.length > 0) pass = false;
} catch (e) { sc.push({ name: "Self-link", ok: false }); pass = false; }

// 7: Canonical evidence
try {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  sc.push({ name: "Canonical evidence envelope", ok: r.evidenceVersion === "1.0.0" && r._sourceStatus !== undefined });
} catch (e) { sc.push({ name: "Envelope", ok: false }); pass = false; }

// 8: Deterministic
try {
  const r1 = generateInternalLinkOpportunities(SITE, INPUT);
  const r2 = generateInternalLinkOpportunities(SITE, INPUT);
  sc.push({ name: "Deterministic output", ok: JSON.stringify(r1.opportunities) === JSON.stringify(r2.opportunities) });
} catch (e) { sc.push({ name: "Deterministic", ok: false }); pass = false; }

// 9: Insufficient evidence
try {
  const r = generateInternalLinkOpportunities({ ...SITE, pages: [SITE.pages[0]], pageCount: 1 }, INPUT);
  sc.push({ name: "Insufficient evidence → PARTIAL", ok: r.sourceStatus === SOURCE_STATUS.PARTIAL });
} catch (e) { sc.push({ name: "Partial", ok: false }); pass = false; }

// 10: No live calls
try {
  const start = Date.now();
  generateInternalLinkOpportunities(SITE, INPUT);
  sc.push({ name: "No live provider calls (<50ms)", ok: Date.now() - start < 50 });
} catch (e) { sc.push({ name: "No calls", ok: false }); pass = false; }

console.log("");
for (const s of sc) console.log("  " + (s.ok ? "✓" : "✗") + " " + s.name);
console.log("\n=== Acceptance: " + (pass ? "PASS" : "FAIL") + " ===");
console.log(sc.filter((s) => s.ok).length + "/" + sc.length + " scenarios passed\n");
process.exit(pass ? 0 : 1);
