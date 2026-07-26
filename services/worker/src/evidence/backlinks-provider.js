import { withTimeout, domainOf } from "../utils.js";
import { SOURCE_STATUS, ERROR_CATEGORY, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";

const API_BASE = "https://api.dataforseo.com/v3/backlinks";
const SPAM_DOMAIN_RE = /casino|poker|gambling|adult|porn|xxx|payday|loan|viagra|pharma|free-?links|cheap-?seo/i;
const SPAM_ANCHOR_RE = /\b(click here|buy.*cheap|cheap.*buy|best price|casino|poker|viagra|payday loan|adult|porn)\b/i;

function authHeader(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function post(endpoint, tasks, options) {
  const response = await withTimeout((options.fetchImpl || globalThis.fetch)(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: authHeader(options.login, options.password),
      "content-type": "application/json",
    },
    body: JSON.stringify(tasks),
  }), 60000, `DataForSEO ${endpoint}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`DataForSEO ${endpoint} failed (${response.status}): ${text.slice(0, 500)}`);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`DataForSEO ${endpoint} returned invalid JSON`); }
  if (body.status_code && body.status_code !== 20000) throw new Error(`DataForSEO ${endpoint}: ${body.status_message || body.status_code}`);
  const failed = (body.tasks || []).find((task) => task.status_code && task.status_code !== 20000);
  if (failed) throw new Error(`DataForSEO ${endpoint}: ${failed.status_message || failed.status_code}`);
  return body;
}

function firstResult(body) {
  return body.tasks?.[0]?.result?.[0] || {};
}

function allItems(body) {
  return (body.tasks || []).flatMap((task) => task.result || []).flatMap((result) => result.items || []);
}

function keywordScore(record, keywords) {
  const text = [record.anchor, record.page_from_title, record.page_from, record.domain_from]
    .filter(Boolean).join(" ").toLowerCase();
  if (SPAM_DOMAIN_RE.test(record.domain_from || "")) return 0;
  const matches = keywords.filter((keyword) => keyword.length >= 4 && text.includes(keyword.toLowerCase())).length;
  if (matches >= 3) return 25;
  if (matches >= 1) return 18;
  return 8;
}

function authorityScore(rank) {
  if (!Number.isFinite(rank)) return 5;
  if (rank <= 1000) return 25;
  if (rank <= 10000) return 20;
  if (rank <= 100000) return 12;
  if (rank <= 500000) return 6;
  return 0;
}

function placementScore(record) {
  const location = String(record.semantic_location || "").toLowerCase();
  if (["footer", "sidebar", "widget"].includes(location)) return 0;
  if (["article", "section", "content"].includes(location)) return 25;
  if ((record.external_links_count || 0) > 100) return 5;
  return 15;
}

function spamSafetyScore(spamScore) {
  if (!Number.isFinite(spamScore)) return 10;
  if (spamScore <= 30) return 25;
  if (spamScore <= 60) return 10;
  return 0;
}

function normalize(record, context) {
  const referringDomain = record.domain_from || (() => { try { return domainOf(record.page_from); } catch { return ""; } })();
  const relevanceScore = keywordScore(record, context.topicKeywords || []);
  const authority = authorityScore(record.domain_from_rank ?? record.rank);
  const placement = placementScore(record);
  const spamScore = Number.isFinite(record.backlinks_spam_score) ? record.backlinks_spam_score : (Number.isFinite(record.spam_score) ? record.spam_score : null);
  const spamSafety = spamSafetyScore(spamScore);
  const quality = relevanceScore + authority + placement + spamSafety;
  const clientHasLinkFromDomain = context.targetDomains.has(referringDomain);
  const overlapCount = context.competitorOverlap.get(referringDomain)?.size || 0;
  const redFlags = [];
  if (spamScore != null && spamScore >= 61) redFlags.push("high spam score");
  if (SPAM_DOMAIN_RE.test(referringDomain)) redFlags.push("irrelevant or spam-prone domain");
  if (SPAM_ANCHOR_RE.test(record.anchor || "")) redFlags.push("spammy anchor text");
  if (placement === 0) redFlags.push("low-quality placement");
  let bucket = "ignore";
  if (redFlags.length || relevanceScore === 0) bucket = "bad";
  else if (!clientHasLinkFromDomain && overlapCount > 0 && quality >= 70) bucket = "worth_pursuing";
  else if (clientHasLinkFromDomain && quality >= 70) bucket = "good";
  const completeness = [record.page_from, referringDomain, record.page_to, record.anchor, record.semantic_location, record.domain_from_rank, spamScore].filter((v) => v !== null && v !== undefined && v !== "").length / 7;
  const confidence = Math.round(Math.min(0.95, 0.45 + completeness * 0.35 + (overlapCount > 1 ? 0.1 : 0)) * 100) / 100;
  return {
    referringDomain,
    referringPageUrl: record.page_from || "",
    targetUrl: record.page_to || "",
    anchorText: record.anchor || "",
    semanticLocation: record.semantic_location || "unknown",
    domainRank: record.domain_from_rank ?? record.rank ?? null,
    spamScore,
    relevanceScore,
    authorityScore: authority,
    placementScore: placement,
    spamSafetyScore: spamSafety,
    backlinkQualityScore: quality,
    competitorOverlapCount: overlapCount,
    clientHasLinkFromDomain,
    bucket,
    evidenceClass: confidence >= 0.85 ? "strongly_supported" : confidence >= 0.7 ? "supported" : "directional",
    classificationConfidence: confidence,
    rationale: redFlags.length ? `Q=${quality}/100 — ${redFlags.join(", ")}.` : `Q=${quality}/100 — ${bucket.replaceAll("_", " ")}.`,
  };
}

function summarize(records, summary, competitors, requestCount, startedAt, completedAt) {
  const byBucket = (name) => records.filter((r) => r.bucket === name);
  const good = byBucket("good");
  const bad = byBucket("bad");
  const worth = byBucket("worth_pursuing");
  const ignored = byBucket("ignore");
  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "dataforseo",
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    status: SOURCE_STATUS.AVAILABLE, // canonical alias
    provider: "dataforseo",
    totalBacklinksReviewed: records.length,
    goodCount: good.length,
    badCount: bad.length,
    worthPursuingCount: worth.length,
    ignoredCount: ignored.length,
    topGoodLinks: good.sort((a, b) => b.backlinkQualityScore - a.backlinkQualityScore).slice(0, 5),
    topBadLinks: bad.sort((a, b) => a.backlinkQualityScore - b.backlinkQualityScore).slice(0, 10),
    topWorthPursuingDomains: worth.sort((a, b) => b.competitorOverlapCount - a.competitorOverlapCount || b.backlinkQualityScore - a.backlinkQualityScore).slice(0, 10),
    authoritySummary: {
      rank: summary.rank ?? null,
      backlinks: summary.backlinks ?? records.length,
      referringDomains: summary.referring_domains ?? new Set(records.map((r) => r.referringDomain)).size,
      referringPages: summary.referring_pages ?? null,
      backlinksSpamScore: summary.backlinks_spam_score ?? null,
      targetSpamScore: summary.target_spam_score ?? null,
    },
    competitors,
    requestCount,
    collectedAt: completedAt,
    coverage: { requested: records.length, completed: records.length, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: "dataforseo",
      adapterVersion: "1.0.0",
      startedAt,
      completedAt,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: records.length,
      expectedRecordCount: null,
      errorCategory: null,
      limitation: null,
      rawArtifactRef: null,
    }),
    records,
  };
}

export async function collectBacklinks(targetUrl, competitors = [], options = {}) {
  const startedAt = new Date().toISOString();
  if (!options.login || !options.password) {
    const completedAt = new Date().toISOString();
    return {
      evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
      source: "dataforseo",
      sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
      status: SOURCE_STATUS.NOT_CONNECTED,
      provider: "dataforseo",
      affectsCoreAudit: false,
      note: "DataForSEO credentials were not configured. The core website audit completed without backlink evidence.",
      records: [],
      collectedAt: completedAt,
      coverage: { requested: 0, completed: 0, failed: 0 },
      rawArtifactRef: null,
      _sourceStatus: buildSourceStatus({
        provider: "dataforseo",
        adapterVersion: "1.0.0",
        startedAt,
        completedAt,
        requestId: null,
        retryCount: 0,
        returnedRecordCount: 0,
        expectedRecordCount: null,
        errorCategory: ERROR_CATEGORY.NOT_CONFIGURED,
        limitation: "DataForSEO credentials were not configured.",
        rawArtifactRef: null,
      }),
    };
  }
  const target = domainOf(targetUrl);
  const competitorDomains = competitors.slice(0, 3).map(domainOf);
  let requestCount = 0;
  const summaryBody = await post("/summary/live", [{ target, include_subdomains: true, internal_list_limit: 10 }], options);
  requestCount++;
  const backlinksBody = await post("/backlinks/live", [{ target, include_subdomains: true, limit: options.limit || 500, order_by: ["rank,desc"] }], options);
  requestCount++;
  const targetItems = allItems(backlinksBody);
  const competitorItems = [];
  for (const competitor of competitorDomains) {
    const body = await post("/backlinks/live", [{ target: competitor, include_subdomains: true, limit: options.competitorLimit || 250, order_by: ["rank,desc"] }], options);
    requestCount++;
    for (const item of allItems(body)) competitorItems.push({ ...item, _competitor: competitor });
  }
  const targetDomains = new Set(targetItems.map((item) => item.domain_from).filter(Boolean));
  const competitorOverlap = new Map();
  for (const item of competitorItems) {
    const domain = item.domain_from;
    if (!domain) continue;
    if (!competitorOverlap.has(domain)) competitorOverlap.set(domain, new Set());
    competitorOverlap.get(domain).add(item._competitor);
  }
  const context = { targetDomains, competitorOverlap, topicKeywords: options.topicKeywords || [] };
  const combined = [...targetItems, ...competitorItems.filter((item) => !targetDomains.has(item.domain_from))];
  const dedup = new Map();
  for (const item of combined) {
    const key = `${item.page_from || ""}|${item.page_to || ""}|${item.anchor || ""}`;
    if (!dedup.has(key)) dedup.set(key, normalize(item, context));
  }
  const completedAt = new Date().toISOString();
  return summarize([...dedup.values()], firstResult(summaryBody), competitorDomains, requestCount, startedAt, completedAt);
}
