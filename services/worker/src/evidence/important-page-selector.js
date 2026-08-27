/**
 * Deterministic Important-Page Selector
 *
 * Selects the decision-bearing pages that receive deep evidence acquisition
 * (DFS content parsing, resources, redirect chains; later WP-E Playwright
 * conversion-path validation) without requiring a second full crawl.
 *
 * PRYSM-NEXT-01 WP-B-07. EVIDENCE-MATRIX: content.body / technical.resources /
 * technical.redirects acquisition scope.
 *
 * Rules are deterministic and evidence-driven:
 *   - a role is only assigned when positive page evidence matches its intent;
 *   - no arbitrary index-position assignment (CRIT #24);
 *   - roles without evidence are reported as unassessed, never invented;
 *   - ties are broken by (score desc, role priority asc, normalized URL asc);
 *   - the same input ALWAYS produces the same selection.
 */

// ---------------------------------------------------------------------------
// Roles and role priority (lower = selected first)
// ---------------------------------------------------------------------------

export const PAGE_ROLES = Object.freeze({
  HOME: "home",
  CONVERSION: "conversion",
  SERVICE: "service",
  PRICING: "pricing",
  ABOUT: "about",
  PROOF: "proof",
  EDUCATION: "education",
});

const ROLE_PRIORITY = Object.freeze({
  home: 0,
  conversion: 1,
  service: 2,
  pricing: 3,
  about: 4,
  proof: 5,
  education: 6,
});

const ROLE_CAPS = Object.freeze({
  home: 1,
  conversion: 1,
  service: 2,
  pricing: 1,
  about: 1,
  proof: 1,
  education: 1,
});

const MAX_SELECTED_DEFAULT = 10;

// Intent patterns per role (URL, title, H1). A positive match on ANY source
// counts; score sums per-source matches (url match = 2, title = 1, h1 = 1).
const ROLE_PATTERNS = Object.freeze({
  conversion: [
    /\b(book|booking|schedule|scheduling|appointment|contact|quote|request|enquir|inquiry|get[- ]started|sign[- ]up|register|consultation|reserve)\b/i,
  ],
  pricing: [/\b(pricing|price|prices|cost|costs|fees?|investment|rates|packages|plans)\b/i],
  about: [/\b(about|team|story|why[- ]us|who[- ]we[- ]are|company|meet)\b/i],
  proof: [
    /\b(testimonial|testimonials|reviews?|case[- ]stud|success|results|client[- ]stories|portfolio|proof)\b/i,
  ],
  education: [
    /\b(blog|articles?|guides?|learn|resources?|faq|insights?|tips|knowledge)\b/i,
  ],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "") || `${u.protocol}//${u.host}`;
  } catch {
    return String(raw || "")
      .split("#")[0]
      .split("?")[0]
      .replace(/\/+$/, "");
  }
}

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function matchesAnyPattern(text, patterns) {
  const t = String(text || "");
  return patterns.some((re) => re.test(t));
}

function pageH1(page) {
  const h1 = page?.headings?.h1;
  return Array.isArray(h1) && h1.length ? h1[0] : "";
}

function pageStatusOk(page) {
  const status = page?.status ?? page?.statusCode ?? 200;
  return status >= 200 && status < 400;
}

function homeCandidate(page, targetUrl) {
  const targetRoot = normalizeUrl(targetUrl);
  const pageUrl = normalizeUrl(page?.crawledUrl || page?.url || "");
  if (!pageUrl) return false;
  if (pageUrl === targetRoot) return true;
  try {
    const u = new URL(pageUrl);
    const t = new URL(targetRoot);
    return u.host === t.host && (u.pathname === "/" || u.pathname === "");
  } catch {
    return pageUrl === targetRoot;
  }
}

/**
 * Count internal inlinks to a normalized URL from the links array.
 */
function inlinkCount(url, links) {
  const target = normalizeUrl(url);
  let count = 0;
  for (const link of links || []) {
    const dest = normalizeUrl(link?.link_to || link?.url || link?.href || "");
    if (dest === target) count += 1;
  }
  return count;
}

function containsServiceKeyword(text, keywords) {
  if (!keywords || keywords.length === 0) return false;

  const haystack = tokens(text);
  const keywordSet = new Set(
    keywords.flatMap((k) => tokens(k)),
  );

  return haystack.some((w) => keywordSet.has(w));
}

function isEditorialUrl(url) {
  try {
    const pathname = new URL(url).pathname;

    return (
      /\/(?:blog|blogs|article|articles|insights?|news|press|learn|guides?|tips)(?:\/|$)/i.test(
        pathname,
      ) ||
      /\/20\d{2}\/(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])(?:\/|$)/.test(
        pathname,
      )
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------

function scoreCandidate(page, role, ctx) {
  const url = normalizeUrl(page?.crawledUrl || page?.url || "");
  const title = page?.title || "";
  const h1 = pageH1(page);
  if (
    role !== "home" &&
    role !== "education" &&
    isEditorialUrl(url)
  ) {
    return { score: 0, matchedBy: [] };
  }

  let score = 0;
  const matchedBy = [];

  if (role === "home") {
    if (homeCandidate(page, ctx.targetUrl)) {
      score += 5;
      matchedBy.push("url:root");
    } else if ((page?.crawlDepth ?? 999) <= 1 && url) {
      // Secondary signal only — root is still preferred via score.
      score += 2;
      matchedBy.push("depth<=1");
    }
    return { score, matchedBy };
  }

  if (role === "service") {
    const inUrl = containsServiceKeyword(url, ctx.keywords);
    const inTitle = containsServiceKeyword(title, ctx.keywords);
    const inH1 = containsServiceKeyword(h1, ctx.keywords);
    if (inUrl) { score += 2; matchedBy.push("url:keyword"); }
    if (inTitle) { score += 1; matchedBy.push("title:keyword"); }
    if (inH1) { score += 1; matchedBy.push("h1:keyword"); }
    if (score > 0) {
      const inlinks = ctx.inlinks?.get(url) ?? inlinkCount(url, ctx.links);
      score += Math.min(3, Math.floor(inlinks / 2));
    }
    return { score, matchedBy };
  }

  const patterns = ROLE_PATTERNS[role];
  const urlMatch = matchesAnyPattern(url, patterns);
  const titleMatch = matchesAnyPattern(title, patterns);
  const h1Match = matchesAnyPattern(h1, patterns);

  if (urlMatch) { score += 2; matchedBy.push("url"); }
  if (titleMatch) { score += 1; matchedBy.push("title"); }
  if (h1Match) { score += 1; matchedBy.push("h1"); }

  if (role === "conversion") {
    const hasForms = Array.isArray(page?.forms) && page.forms.length > 0;
    const ctaCount = Array.isArray(page?.ctas) ? page.ctas.length : 0;
    if (hasForms) { score += 2; matchedBy.push("form"); }
    if (ctaCount > 0) { score += 1; matchedBy.push("cta"); }
  }

  return { score, matchedBy };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Select important pages deterministically.
 *
 * @param {object} opts
 * @param {string} opts.targetUrl - normalized target website URL.
 * @param {Array<object>} opts.pages - normalized page objects (crawledUrl/url,
 *        title, headings.h1, forms, ctas, status/statusCode, crawlDepth).
 * @param {Array<object>} [opts.links] - internal link records (link_to|url|href).
 * @param {Array<string>} [opts.services] - business service lines (intake).
 * @param {Array<string>} [opts.topicKeywords] - crawl-derived topic keywords.
 * @param {number} [opts.maxSelected=10] - selection cap.
 * @returns {{ selected: Array<{role, url, score, matchedBy}>, roles: object,
 *            unassessedRoles: Array<string>, assessedRoles: Array<string> }}
 */
export function selectImportantPages({
  targetUrl,
  pages = [],
  links = [],
  services = [],
  topicKeywords = [],
  maxSelected = MAX_SELECTED_DEFAULT,
}) {
  const contentPages = (pages || []).filter(
    (p) => (p?.crawledUrl || p?.url) && pageStatusOk(p),
  );

  const keywords = [...(services || []), ...(topicKeywords || [])];
  const inlinks = new Map();
  for (const p of contentPages) {
    inlinks.set(
      normalizeUrl(p.crawledUrl || p.url),
      inlinkCount(p.crawledUrl || p.url, links),
    );
  }

  const ctx = { targetUrl, links, inlinks, keywords };

  // Score every content page for every role.
  const candidatesByRole = new Map();
  for (const role of Object.values(PAGE_ROLES)) {
    const candidates = [];
    for (const page of contentPages) {
      const url = normalizeUrl(page.crawledUrl || page.url);
      const { score, matchedBy } = scoreCandidate(page, role, ctx);
      if (score > 0) {
        candidates.push({ role, url, score, matchedBy, page });
      }
    }
    // Deterministic order: score desc, then URL asc.
    candidates.sort((a, b) =>
      b.score - a.score || a.url.localeCompare(b.url));
    candidatesByRole.set(role, candidates);
  }

  // Select in role-priority order, respecting caps and global max.
  const selected = [];
  const selectedUrls = new Set();
  const roles = {};
  const assessedRoles = [];
  const unassessedRoles = [];

  for (const role of Object.keys(ROLE_PRIORITY).sort(
    (a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b],
  )) {
    const cap = ROLE_CAPS[role] ?? 1;
    const candidates = candidatesByRole.get(role) || [];
    if (candidates.length === 0) {
      roles[role] = [];
      unassessedRoles.push(role);
      continue;
    }
    let taken = 0;
    for (const candidate of candidates) {
      if (taken >= cap) break;
      if (selected.length >= (maxSelected ?? MAX_SELECTED_DEFAULT)) break;
      if (selectedUrls.has(candidate.url)) continue;
      selected.push({
        role: candidate.role,
        url: candidate.url,
        score: candidate.score,
        matchedBy: candidate.matchedBy,
      });
      selectedUrls.add(candidate.url);
      taken += 1;
    }
    if (taken > 0) {
      roles[role] = selected.filter((s) => s.role === role).map((s) => s.url);
      assessedRoles.push(role);
    } else {
      // Every candidate was already selected under a higher-priority role —
      // the role's evidence lives on that shared URL (e.g. conversion form
      // on the homepage). Assessed at the shared URL, never invented.
      roles[role] = [candidates[0].url];
      assessedRoles.push(role);
    }
  }

  return { selected, roles, assessedRoles, unassessedRoles };
}

export default { selectImportantPages, PAGE_ROLES, normalizeUrl };
