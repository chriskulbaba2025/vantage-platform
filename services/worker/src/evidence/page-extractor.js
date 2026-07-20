import * as cheerio from "cheerio";

const CTA_RE = /\b(book|schedule|contact|call|subscribe|buy|start|get started|learn more|request|download|join|register|sign up|free consultation|discovery)\b/i;
const TESTIMONIAL_RE = /\b(testimonials?|what clients say|client stories|reviews?|success stor(?:y|ies))\b/i;
const CREDENTIAL_RE = /\b(certified|certification|licensed|registered|credential|years? experience|member of|accredited|degree|diploma)\b/i;
const CASE_RE = /\b(case stud(?:y|ies)|client result|before and after|outcome)\b/i;
const FAQ_RE = /\b(faq|frequently asked|common questions)\b/i;
const PRICE_RE = /(?:\$|CAD\s?\$|USD\s?\$|£|€)\s?\d|\b(pricing|price|cost|investment|fee)\b/i;
const POLICY_RE = /\b(privacy|terms|refund|cancellation|cookie policy)\b/i;
const SOCIAL_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "youtube.com", "tiktok.com", "x.com", "twitter.com"];

// ── Validated service extraction ──────────────────────────────────────────

const GENERIC_HEADINGS = new Set([
  "services", "service areas", "learn more", "contact", "book", "assessment",
  "about", "faq", "get started", "our services", "what we do", "solutions",
  "welcome", "home", "more info", "details", "resources", "get in touch",
  "contact us", "about us", "our team", "our story", "blog", "news",
  "privacy policy", "terms of service", "terms and conditions",
]);

const INSTRUCTIONAL_STARTS = new Set([
  "learn", "book", "contact", "call", "schedule", "subscribe", "buy",
  "start", "get", "download", "join", "register", "sign", "request",
  "discover", "explore", "find", "read", "see", "view", "try", "visit",
  "click", "check", "go", "ask", "answer", "tell", "know", "need",
  "want", "like", "help", "match", "we", "i", "you", "do", "does",
  "how", "what", "when", "where", "why", "who", "can", "will", "should",
  "would", "could", "shall", "may", "might", "must", "let", "make",
  "take", "give", "use", "choose", "select", "pick", "search", "look",
  "browse", "shop", "order", "pay", "submit", "send", "share", "follow",
]);

function isValidServiceText(text) {
  const cleaned = text.trim();
  if (!cleaned) return false;
  const lower = cleaned.toLowerCase();

  // Reject questions
  if (cleaned.includes("?")) return false;

  // Reject full sentences (text ending with sentence punctuation)
  if (/[.!;:]$/.test(cleaned)) return false;

  // Reject generic headings
  if (GENERIC_HEADINGS.has(lower)) return false;

  // Word count: 1–6 words
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;

  // Reject CTAs
  if (CTA_RE.test(lower)) return false;

  // Reject instructional / nav / sentence starts
  if (INSTRUCTIONAL_STARTS.has(words[0])) return false;

  // Reject if it starts with an article, preposition, or conjunction
  if (/^(the|a|an|our|your|their|its|this|that|these|those|with|without|for|from|and|or|but|in|on|at|to|by|of|via|per)\b/i.test(words[0])) return false;

  // Must contain at least one meaningful content word (4+ chars, not a
  // generic filler)
  const GENERIC_FILLERS = new Set([
    "service", "services", "area", "areas", "learn", "more", "contact",
    "book", "about", "assessment", "solution", "solutions", "care",
    "help", "support", "team", "info", "information", "resource",
    "resources", "welcome", "home", "page", "online", "professional",
    "quality", "best", "top", "expert", "experts", "special", "dedicated",
    "comprehensive", "complete", "custom", "personal", "individual",
    "unique", "innovative", "advanced", "modern", "proven", "trusted",
    "leading", "premier", "premium", "affordable", "effective",
    "efficient", "reliable", "safe", "convenient", "flexible",
    "available", "new", "better", "right", "good", "great",
  ]);
  const hasMeaningfulWord = words.some((w) => {
    const clean = w.replace(/[^a-z]/g, "");
    return clean.length >= 4 && !GENERIC_FILLERS.has(clean);
  });
  return hasMeaningfulWord;
}

function extractSchemaServices($) {
  const services = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        const type = node["@type"];
        const typeList = Array.isArray(type) ? type : type ? [type] : [];
        for (const t of typeList) {
          const tLower = String(t).toLowerCase();
          if (tLower === "service" || tLower === "offercatalog") {
            const name = node.name;
            if (name && typeof name === "string" && name.trim()) {
              services.push(cleanText(name));
            }
            if (node.itemListElement && Array.isArray(node.itemListElement)) {
              for (const item of node.itemListElement) {
                const itemName = item?.item?.name || item?.name || "";
                if (itemName && typeof itemName === "string" && itemName.trim()) {
                  services.push(cleanText(itemName));
                }
              }
            }
          }
        }
        Object.values(node).forEach(visit);
      };
      visit(data);
    } catch { /* ignore invalid JSON */ }
  });
  return [...new Set(services.filter(Boolean))];
}

function absoluteUrl(href, base, allowedProtocols = ["http:", "https:"]) {
  try {
    const url = new URL(href, base);
    if (!allowedProtocols.includes(url.protocol)) return null;
    if (["http:", "https:"].includes(url.protocol)) url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseSchemaTypes($) {
  const types = new Set();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const value = JSON.parse($(el).text());
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        const type = node["@type"];
        if (Array.isArray(type)) type.forEach((t) => types.add(String(t)));
        else if (type) types.add(String(type));
        Object.values(node).forEach(visit);
      };
      visit(value);
    } catch {
      types.add("InvalidJSONLD");
    }
  });
  return [...types].sort();
}

function detectPlatform($, html, headers) {
  const generator = cleanText($('meta[name="generator"]').attr("content"));
  const haystack = `${generator} ${html.slice(0, 120000)}`.toLowerCase();
  if (haystack.includes("godaddy website builder") || haystack.includes("wsimg.com")) return "GoDaddy Website Builder";
  if (haystack.includes("wp-content") || haystack.includes("wordpress")) return "WordPress";
  if (haystack.includes("wixstatic.com") || haystack.includes("wix.com")) return "Wix";
  if (haystack.includes("squarespace")) return "Squarespace";
  if (haystack.includes("cdn.shopify.com") || headers.get("x-shopid")) return "Shopify";
  if (haystack.includes("webflow")) return "Webflow";
  if (haystack.includes("__next_data__") || haystack.includes("/_next/")) return "Next.js";
  return generator || "Unknown";
}

export function extractPage(url, status, headers, html, rendered = false) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  const bodyText = cleanText($("body").text());
  const words = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const headings = {};
  for (let level = 1; level <= 6; level++) {
    headings[`h${level}`] = $(`h${level}`).map((_, el) => cleanText($(el).text())).get().filter(Boolean);
  }

  const links = $("a[href]").map((_, el) => {
    const href = absoluteUrl($(el).attr("href"), url, ["http:", "https:", "mailto:", "tel:"]);
    return href ? { url: href, text: cleanText($(el).text()), target: $(el).attr("target") || "" } : null;
  }).get().filter(Boolean);
  const buttons = $("button, input[type=submit], [role=button]").map((_, el) => cleanText($(el).text() || $(el).attr("value") || $(el).attr("aria-label"))).get().filter(Boolean);
  const ctas = [...links.filter((l) => CTA_RE.test(l.text)).map((l) => ({ text: l.text, url: l.url, kind: "link" })), ...buttons.filter((b) => CTA_RE.test(b)).map((b) => ({ text: b, url, kind: "button" }))];
  const images = $("img").map((_, el) => ({
    src: absoluteUrl($(el).attr("src") || $(el).attr("data-src"), url),
    alt: cleanText($(el).attr("alt")),
    width: $(el).attr("width") || null,
    height: $(el).attr("height") || null,
    loading: $(el).attr("loading") || null,
  })).get();
  const forms = $("form").map((_, el) => ({
    action: absoluteUrl($(el).attr("action") || url, url),
    method: ($(el).attr("method") || "get").toLowerCase(),
    fields: $(el).find("input,select,textarea").length,
    hasCaptcha: /captcha|recaptcha/i.test($(el).html() || ""),
  })).get();

  const title = cleanText($("title").first().text());
  const description = cleanText($('meta[name="description"]').attr("content"));
  const canonical = absoluteUrl($('link[rel="canonical"]').attr("href"), url);
  const language = $("html").attr("lang") || "";
  const socialLinks = links.filter((l) => {
    try {
      return ["http:", "https:"].includes(new URL(l.url).protocol) && SOCIAL_HOSTS.some((host) => new URL(l.url).hostname.includes(host));
    } catch {
      return false;
    }
  });
  const emailLinks = links.filter((l) => l.url.startsWith("mailto:"));
  const phoneLinks = links.filter((l) => l.url.startsWith("tel:"));
  // ── Validated service extraction ──
  // 1. Schema markup (Service / OfferCatalog) — highest confidence
  // Use a fresh cheerio instance — scripts are removed from $ above
  const schemaServices = extractSchemaServices(cheerio.load(html));

  // 2. H2 / H3 headings that pass strict validation (not CTAs, questions,
  //    navigation labels, generic headings, instructional sentences, or
  //    single-word fillers)
  const headingServices = [...headings.h2, ...headings.h3]
    .filter((text) => text.length > 2 && text.length < 80 && isValidServiceText(text));

  // Merge: schema first, then heading-derived (deduplicated, case-insensitive)
  const seen = new Set(schemaServices.map((s) => s.toLowerCase()));
  const merged = [...schemaServices];
  for (const s of headingServices) {
    if (!seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      merged.push(s);
    }
  }
  const serviceCandidates = merged;

  return {
    url,
    status,
    rendered,
    title,
    description,
    canonical,
    language,
    generator: cleanText($('meta[name="generator"]').attr("content")),
    platform: detectPlatform($, html, headers),
    words,
    headings,
    schemaTypes: parseSchemaTypes(cheerio.load(html)),
    links,
    ctas,
    images,
    forms,
    socialLinks,
    emailLinks,
    phoneLinks,
    serviceCandidates: [...new Set(serviceCandidates)].slice(0, 20),
    signals: {
      testimonials: TESTIMONIAL_RE.test(bodyText),
      credentials: CREDENTIAL_RE.test(bodyText),
      caseStudies: CASE_RE.test(bodyText),
      faq: FAQ_RE.test(bodyText),
      pricing: PRICE_RE.test(bodyText),
      policies: POLICY_RE.test(bodyText),
      contact: forms.length > 0 || /contact/i.test(bodyText) || emailLinks.length > 0 || phoneLinks.length > 0,
    },
    bodyText: bodyText.slice(0, 50000),
    responseHeaders: Object.fromEntries(headers.entries()),
  };
}

