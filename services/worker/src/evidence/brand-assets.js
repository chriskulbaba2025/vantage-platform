import * as cheerio from "cheerio";

const SOURCE_PRIORITY = Object.freeze({
  "header-logo": 1,
  "structured-data": 2,
  "site-identity": 3,
  favicon: 4,
  "og-image": 5,
});

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function host(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch { return ""; }
}

function sameOrSubdomain(assetHost, siteHost) {
  return Boolean(assetHost && siteHost && (assetHost === siteHost || assetHost.endsWith(`.${siteHost}`)));
}

function nameTokens(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((token) => token.length > 2);
}

function identityMatches(identityText, businessName) {
  if (!identityText || !businessName) return true;
  const wanted = new Set(nameTokens(businessName));
  const actual = nameTokens(identityText);
  return actual.length > 0 && (actual.some((token) => wanted.has(token)) || wanted.has(actual.join(" ")));
}

function imageType(url, declared = "") {
  const value = `${url} ${declared}`.toLowerCase();
  if (value.includes("svg")) return "SVG";
  if (value.includes("png")) return "PNG";
  if (value.includes("jpg") || value.includes("jpeg")) return "JPG";
  if (value.includes("webp")) return "WEBP";
  if (value.includes("ico") || value.includes("icon")) return "ICON";
  return "IMAGE";
}

function candidate({ url, sourceUrl, sourceType, identityText = "", likelyLogo = false, declaredType = "" }) {
  return { url: validUrl(url), sourceUrl: validUrl(sourceUrl), sourceType, assetType: imageType(url, declaredType), identityText: clean(identityText), likelyLogo: Boolean(likelyLogo) };
}

export function makeBrandAssetCandidate(input) {
  return candidate(input);
}

function schemaLogoCandidates($, pageUrl) {
  const out = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).filter(Boolean).map((v) => String(v).toLowerCase());
        if (types.some((type) => type === "organization" || type === "localbusiness" || type.endsWith("business"))) {
          const logo = typeof node.logo === "string" ? node.logo : node.logo?.url || node.image?.url || node.image;
          if (logo) out.push(candidate({ url: new URL(logo, pageUrl).toString(), sourceUrl: pageUrl, sourceType: "structured-data", identityText: node.name, likelyLogo: true }));
        }
        Object.values(node).forEach(visit);
      };
      visit(JSON.parse($(el).text()));
    } catch { /* malformed structured data is not evidence */ }
  });
  return out;
}

export function collectBrandAssetCandidates(html, pageUrl) {
  const $ = cheerio.load(html || "");
  const out = [];
  const add = (value, type, identityText, likelyLogo, declaredType) => {
    const url = validUrl(value ? new URL(value, pageUrl).toString() : "");
    if (url) out.push(candidate({ url, sourceUrl: pageUrl, sourceType: type, identityText, likelyLogo, declaredType }));
  };
  $("header img, nav img, img[alt*='logo' i], img[alt*='brand' i]").each((_, el) => add($(el).attr("src") || $(el).attr("data-src"), "header-logo", $(el).attr("alt"), true, $(el).attr("type")));
  $("link[rel~='icon'], link[rel='apple-touch-icon']").each((_, el) => add($(el).attr("href"), "favicon", "", true, $(el).attr("type")));
  schemaLogoCandidates($, pageUrl).forEach((item) => out.push(item));
  const og = $("meta[property='og:image'], meta[name='twitter:image']").attr("content");
  if (og) add(og, "og-image", "", false, "");
  return out.filter((item) => item.url && item.sourceUrl);
}

export function verifyBrandAsset(candidateInput, { canonicalDomain, businessName }) {
  const item = candidateInput || {};
  const assetHost = host(item.url);
  const siteHost = host(`https://${canonicalDomain || ""}`);
  const firstParty = sameOrSubdomain(assetHost, siteHost);
  const identityMatch = identityMatches(item.identityText, businessName);
  const valid = Boolean(validUrl(item.url) && validUrl(item.sourceUrl));
  const likelyLogo = (item.likelyLogo === true || ["header-logo", "structured-data", "site-identity", "favicon"].includes(item.sourceType)) && item.sourceType !== "og-image";
  const verified = Boolean(firstParty && identityMatch && valid && likelyLogo);
  return {
    url: validUrl(item.url) || null,
    sourceUrl: validUrl(item.sourceUrl) || null,
    sourceType: item.sourceType || "unknown",
    assetType: item.assetType || imageType(item.url),
    firstParty,
    verified,
    verificationReason: !valid ? "invalid_asset_or_source_url" : !firstParty ? "asset_is_not_first_party" : !identityMatch ? "business_identity_conflict" : !likelyLogo ? "asset_is_not_verified_logo_candidate" : "first_party_logo_candidate_verified",
  };
}

export function normalizeBrandIdentity({ candidates = [], canonicalDomain, businessName }) {
  const checked = candidates.map((item) => verifyBrandAsset(item, { canonicalDomain, businessName }));
  const verified = checked.filter((item) => item.verified).sort((a, b) => (SOURCE_PRIORITY[a.sourceType] || 99) - (SOURCE_PRIORITY[b.sourceType] || 99));
  const logo = verified[0] || null;
  return {
    businessName: clean(businessName),
    canonicalDomain: clean(canonicalDomain),
    logo,
    candidates: checked,
    verificationStatus: logo ? "AVAILABLE" : checked.length ? "PARTIAL" : "UNAVAILABLE",
  };
}

export function summarizeBrandAssets(pages, { canonicalDomain, businessName } = {}) {
  const candidates = (Array.isArray(pages) ? pages : []).flatMap((page) => page.brandAssetCandidates || []);
  return normalizeBrandIdentity({ candidates, canonicalDomain, businessName });
}

export { SOURCE_PRIORITY };
