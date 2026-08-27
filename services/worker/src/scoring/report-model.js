import { domainOf } from "../utils.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";
import { band, scoreTrust } from "./score-components.js";

function buildConversionPaths(
  site,
  capabilities = {},
) {
  const unique = [];
  const seen = new Set();

  for (const cta of site.ctas) {
    const key =
      `${cta.text}|${cta.url}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cta);
    }
  }

  const paths =
    unique
      .slice(0, 2)
      .map((cta, index) => {
        let host = "on-site";

        try {
          if (
            domainOf(cta.url) !==
            site.domain
          ) {
            host =
              new URL(
                cta.url,
              ).hostname;
          }
        } catch {
          /* ignore */
        }

        const blockers = [];

        if (
          !site.trust.testimonials &&
          !site.trust.credentials
        ) {
          blockers.push(
            "no trust proof",
          );
        }

        if (!site.trust.pricing) {
          blockers.push(
            "no pricing context",
          );
        }

        if (!site.trust.policies) {
          blockers.push(
            "no policy or next-step reassurance",
          );
        }

        const cleanCta = cta
          ? {
              text:
                cta.text || "",
              url:
                cta.url || "",
            }
          : null;

        return {
          name:
            `${index === 0 ? "Primary" : "Secondary"} Path: ${cta.text || "Conversion action"}`,
          cta: cleanCta,
          host,
          steps: [
            "Land on the relevant page",
            `Locate "${cta.text || "the call to action"}"`,
            `Continue through ${host}`,
            "Complete the requested action",
          ],
          blockers,
          status:
            blockers.length === 0
              ? "Clear"
              : blockers.length <= 1
                ? "Weak"
                : "Missing support",
        };
      });

  if (!paths.length) {
    const browserCta =
      capabilities[
        "conversion.cta"
      ]?.browserSummary;

    const pathCap =
      capabilities[
        "conversion.path"
      ];

    const browserAssessed =
      pathCap?.validated === true &&
      (browserCta?.completed ?? 0) > 0;

    if (browserAssessed) {
      const requested =
        browserCta.requested;

      const completed =
        browserCta.completed;

      const present =
        browserCta.presentPages;

      const ready =
        browserCta.readyPages;

      const fullCoverage =
        requested > 0 &&
        completed === requested;

      const blockers = [];

      if (!fullCoverage) {
        blockers.push(
          "browser validation coverage is partial",
        );
      }

      if (
        fullCoverage &&
        present === 0
      ) {
        blockers.push(
          "no conversion action found on browser-assessed pages",
        );
      } else if (
        ready < completed
      ) {
        blockers.push(
          "conversion action is not ready on every browser-assessed page",
        );
      }

      if (
        !site.trust.testimonials &&
        !site.trust.credentials
      ) {
        blockers.push(
          "no trust proof",
        );
      }

      if (!site.trust.pricing) {
        blockers.push(
          "no pricing context",
        );
      }

      if (!site.trust.policies) {
        blockers.push(
          "no policy or next-step reassurance",
        );
      }

      let status;

      if (
        fullCoverage &&
        present === 0
      ) {
        status = "Missing";
      } else if (
        !fullCoverage ||
        ready < completed
      ) {
        status = "Weak";
      } else {
        status =
          blockers.length === 0
            ? "Clear"
            : blockers.length <= 1
              ? "Weak"
              : "Missing support";
      }

      paths.push({
        name:
          "Primary conversion path",
        cta: null,
        host: "none",
        steps: [
          `Browser validation assessed conversion actions on ${completed} of ${requested} selected page(s).`,
          present > 0
            ? `A conversion action was observed on ${present} assessed page(s).`
            : "No conversion action was observed on the assessed pages.",
          ready > 0
            ? `A visible, interactable, unobstructed action was confirmed on ${ready} assessed page(s).`
            : "No fully ready conversion action was confirmed on the assessed pages.",
        ],
        blockers,
        status,
      });
    } else if (
      site._interactiveEvidenceAvailable !== true
    ) {
      paths.push({
        name:
          "Primary conversion path",
        cta: null,
        host: "none",
        steps: [
          "Interactive conversion-path evidence was not collected for this audit.",
        ],
        blockers: [],
        status:
          "Not Assessed",
      });
    } else {
      paths.push({
        name:
          "Primary conversion path",
        cta: null,
        host: "none",
        steps: [
          "Land on the website",
          "Search for a clear next step",
        ],
        blockers: [
          "no clear conversion action detected",
        ],
        status:
          "Missing",
      });
    }
  }

  return paths;
}

// ---------------------------------------------------------------------------
// PRYSM-NEXT-01 WP-D-06 — defensible, evidence-driven funnel stages.
// A service's stage is derived from the page purpose of the page that
// carries it (form/CTA → BOFU; testimonial/case-study → MOFU;
// educational → TOFU).  No page-purpose evidence → "Not Assessed".
// ---------------------------------------------------------------------------

const STAGE_PATTERNS = Object.freeze({
  BOFU: [/\b(book|booking|schedule|contact|quote|request|pricing|price|cost|register|sign.?up|consultation|appointment)\b/i],
  MOFU: [/\b(testimonial|review|case.?stud|success|results?|client.?stories|portfolio|proof|faq|compare|comparison)\b/i],
  TOFU: [/\b(blog|article|guide|learn|resources?|insights?|tips|what.?is|why|education|training)\b/i],
});

function pagePurposeStage(page) {
  const text = [page?.title || "", ...(page?.headings?.h1 || [])].join(" ");
  const hasForm = Array.isArray(page?.forms) && page.forms.length > 0;
  const hasCta = Array.isArray(page?.ctas) && page.ctas.length > 0;

  if (hasForm || hasCta) return "BOFU";
  if (STAGE_PATTERNS.BOFU.some((re) => re.test(text))) return "BOFU";
  if (STAGE_PATTERNS.MOFU.some((re) => re.test(text))) return "MOFU";
  if (STAGE_PATTERNS.TOFU.some((re) => re.test(text))) return "TOFU";
  return null;
}

/**
 * Deterministic site-level fallback when a service has no page-purpose
 * evidence.  The frozen v1 report-view-model stage enum only allows
 * TOFU/MOFU/BOFU — "Not Assessed" rows cannot be carried in the v1 shape;
 * report design v2 (WP-G) carries true Not-Assessed rows in its own model.
 * Rule: conversion affordances at site level → BOFU; proof content → MOFU;
 * otherwise TOFU (early-journey assumption, documented).
 */
function siteFallbackStage(site) {
  const hasForms = Array.isArray(site.forms) && site.forms.length > 0;
  if (hasForms || site.trust?.pricing) return "BOFU";
  if (site.trust?.testimonials || site.trust?.caseStudies) return "MOFU";
  return "TOFU";
}

function tokenMatch(text, tokensArr) {
  const words = String(text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const set = new Set(tokensArr.map((t) => String(t).toLowerCase()));
  return words.some((w) => set.has(w)) || set.has(String(text || "").toLowerCase().trim());
}

function topicRows(site, input = {}, capabilities = {}) {
  // Prefer business-context services; fall back to validated crawl services;
  // finally multi-word topicKeywords.
  const business = (input.services || []).filter(Boolean);
  const services = business.length
    ? business
    : site.services.length
      ? site.services
      : site.topicKeywords.filter((t) => t.split(/\s+/).length >= 2).slice(0, 8);

  // Find the page that carries each service (title/H1/URL keyword match) —
  // deterministic: first match by crawled order.
  const pages = Array.isArray(site.pages) ? site.pages : [];
  const servicePages = new Map();
  for (const service of services) {
    const tokensArr = String(service).toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const page = pages.find(
      (p) => tokenMatch(p?.title || "", tokensArr) ||
        tokenMatch((p?.headings?.h1 || []).join(" "), tokensArr) ||
        tokenMatch(p?.crawledUrl || p?.url || "", tokensArr),
    );
    servicePages.set(service, page || null);
  }

  const pretty = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

  // CRIT defect 3a — per-topic trust/CTA claims require the underlying
  // evidence. When trust-proof evidence is not available, topic rows must
  // not assert blockers or trust assets from unknown booleans.
  const trustCap =
    capabilities["trust.proof"];

  const trustEvidenceAvailable =
    trustCap?.status === "AVAILABLE" ||
    trustCap?.status === "PARTIAL";

  const bookingCta =
    (site.ctas || []).some((c) =>
      /book|schedule|reserve|appointment/i.test(
        String(c?.text || ""),
      ),
    );

  const browserCta =
    capabilities[
      "conversion.cta"
    ]?.browserSummary;

  const browserForm =
    capabilities[
      "conversion.form"
    ]?.browserSummary;

  const browserInteractiveAssessed =
    site._interactiveEvidenceAvailable === false &&
    (
      (browserCta?.completed ?? 0) > 0 ||
      (browserForm?.completed ?? 0) > 0
    );

  const browserCtaFullCoverage =
    (browserCta?.requested ?? 0) > 0 &&
    browserCta.completed ===
      browserCta.requested;

  return services.slice(0, 8).map(
    (service, index) => {
      const page =
        servicePages.get(service);

      const stage = page
        ? (
            pagePurposeStage(page) ||
            siteFallbackStage(site)
          )
        : siteFallbackStage(site);

      const blocker =
        !trustEvidenceAvailable
          ? "Not Assessed"
          : stage === "BOFU" &&
              !site.trust.pricing
            ? "Offer clarity"
            : !site.trust.credentials
              ? "Doubt"
              : "Unclear next step";

      const trustAsset =
        !trustEvidenceAvailable
          ? "Not Assessed"
          : !site.trust.credentials
            ? "Credential"
            : !site.trust.testimonials
              ? "Testimonial"
              : "Process proof";

      const eeat =
        !trustEvidenceAvailable
          ? "Not Assessed"
          : !site.trust.credentials
            ? "Expertise proof"
            : "Experience proof";

      // Never invent CTA text/type. Browser evidence can establish only
      // that a conversion action or conversion-relevant form was observed.
      const cta =
        site.forms.length
          ? "Form"
          : bookingCta
            ? "Book"
            : (
                browserInteractiveAssessed &&
                (browserForm?.readyPages ?? 0) > 0
              )
              ? "Form"
              : (
                  browserInteractiveAssessed &&
                  (browserCta?.presentPages ?? 0) > 0
                )
                ? "Action"
                : browserInteractiveAssessed
                  ? "None observed"
                  : "Not Assessed";

      const browserPath =
        !browserCtaFullCoverage
          ? "Weak"
          : (browserCta?.presentPages ?? 0) === 0
            ? "Missing"
            : browserCta.readyPages ===
                browserCta.completed
              ? "Clear"
              : "Weak";

      const interactiveRan =
        site._interactiveEvidenceAvailable !== false;

      const path =
        site.ctas.length
          ? stage === "BOFU"
            ? "Clear"
            : "Weak"
          : browserInteractiveAssessed
            ? browserPath
            : interactiveRan
              ? "Missing"
              : "Not Assessed";
    return {
      topic: typeof service === "string" ? pretty(service) : String(service),
      stage,
      blocker,
      trustAsset,
      eeat,
      cta,
      path,
      priority: index < 4 ? "H" : index < 7 ? "M" : "L",
    };
  });
}

// ---------------------------------------------------------------------------
// PRYSM-V2-REPORT-DEPTH-01 — deterministic goal-phrase grammar.
//
// The v1 generator interpolated the raw primaryGoal into noun slots, which
// produced client-visible breakage such as "Your First Step Toward Generate
// qualified enquiries" and "Business Coaching for generate qualified
// enquiries".  A supplied goal is usually an imperative verb phrase; a noun
// slot needs a gerund.  This is a fixed grammatical transform — no LLM, no
// rewriting of the supplied business wording beyond the leading verb.
// ---------------------------------------------------------------------------

/** Conversion verbs whose gerund form is safe to derive deterministically. */
const GOAL_VERBS = new Set([
  "generate", "book", "increase", "request", "schedule", "get", "grow", "drive",
  "boost", "build", "convert", "capture", "attract", "sell", "improve", "raise",
  "win", "secure", "fill", "reduce", "start", "launch", "expand", "acquire",
  "contact", "call", "buy", "join", "subscribe", "register", "enquire",
  "inquire", "apply", "download", "order", "reserve", "close", "earn", "add",
]);

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Standard English gerund formation, applied only to known verbs. */
function toGerund(verb) {
  if (verb.endsWith("ie")) return `${verb.slice(0, -2)}ying`;
  if (verb.endsWith("ee") || verb.endsWith("oe") || verb.endsWith("ye")) return `${verb}ing`;
  if (verb.endsWith("e")) return `${verb.slice(0, -1)}ing`;
  // Consonant–vowel–consonant doubling for short verbs (run -> running).
  if (verb.length <= 5) {
    const [c1, v1, c2] = [verb.at(-3), verb.at(-2), verb.at(-1)];
    if (c1 && !VOWELS.has(c1) && v1 && VOWELS.has(v1) && c2 && !VOWELS.has(c2) && !"wxy".includes(c2)) {
      return `${verb}${c2}ing`;
    }
  }
  return `${verb}ing`;
}

/** Truncate on a word boundary so a goal is never cut mid-word. */
function trimToWords(text, max) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
}

/**
 * Build grammatical renderings of a supplied primary goal.
 *
 * @returns {{raw: string, gerund: string|null}|null}
 */
function goalPhrases(goal) {
  const raw = trimToWords(goal, 40);
  if (!raw) return null;
  const [first, ...rest] = raw.split(/\s+/);
  const lead = first.toLowerCase();
  const gerund = GOAL_VERBS.has(lead)
    ? [toGerund(lead), ...rest].join(" ")
    : null;
  return { raw, gerund };
}

function contentIdeas(site, input = {}) {
  // PRYSM-NEXT-01 WP-D-05 — business-context topics first (intake
  // services), then crawl services, then multi-word topicKeywords.
  // Single short words (like "foot") are rejected because they produce
  // nonsensical content ideas such as "What Is Foot?".
  const candidates = [
    ...(input.services || []),
    ...site.services,
    ...site.topicKeywords.filter((t) => t.split(/\s+/).length >= 2),
  ];
  const deduped = [...new Set(candidates.map((s) => s.toLowerCase()))];
  const topics = deduped.slice(0, 3);
  // Business-context primary goal (WP-D-05) — used only to frame the
  // generated idea text; never invents evidence or changes scores.
  const goal = typeof input.primaryGoal === "string" && input.primaryGoal.trim()
    ? input.primaryGoal.trim()
    : null;
  const goalPhrase = goalPhrases(goal);

  // Fallback when no meaningful topics are available — use multi-word
  // placeholders so generated ideas are still useful.
  const safeTopics = topics.length
    ? topics
    : ["your service", "the process", "your goals"];

  const pretty = (s) => {
    const titleCase = String(s).replace(/\b\w/g, (c) => c.toUpperCase());
    // Defense-in-depth: if a single short word slipped through, prefix it
    // so we never produce "What Is Foot?" in a report.
    if (titleCase.split(/\s+/).length === 1 && titleCase.length < 7) {
      return `Professional ${titleCase}`;
    }
    return titleCase;
  };

  const [t0, t1, t2] = [pretty(safeTopics[0]), pretty(safeTopics[1]), pretty(safeTopics[2])];
  return {
    tofu: [
      { idea: `What Is ${t0}?`, frame: "Answer-first", type: "Guide", question: "What is this?", priority: "H" },
      { idea: `Signs You May Need ${t1}`, frame: "Answer-first", type: "Article", question: "Does this apply to me?", priority: "M" },
      { idea: `Can ${t0} Produce Measurable Change?`, frame: "Objection handler", type: "Educational page", question: "Will this work?", priority: "H" },
    ],
    mofu: [
      { idea: `${t0}: Options and Fit`, frame: "Comparison/fit", type: "Comparison page", question: "Which option is right?", priority: "H" },
      { idea: "What Happens in the Process", frame: "Process page", type: "Process page", question: "What should I expect?", priority: "H" },
      { idea: "Client Results and Outcomes", frame: "Case study", type: "Case study", question: "What results are possible?", priority: "H" },
      { idea: "Who Leads This Work?", frame: "Founder/expert", type: "Founder page", question: "Why trust this provider?", priority: "H" },
    ],
    bofu: [
      { idea: "Pricing and What to Expect", frame: "Risk-reversal", type: "Pricing page", question: "What does it cost?", priority: "H" },
      {
        // A noun slot needs a noun: use the gerund when the goal begins with a
        // known conversion verb, otherwise avoid the preposition entirely.
        idea: goalPhrase
          ? goalPhrase.gerund
            ? `Your First Step Toward ${goalPhrase.gerund}`
            : `Your First Step — ${goalPhrase.raw}`
          : "Your First Step",
        frame: "Process page", type: "Start-here", question: "What happens after I act?", priority: "H",
      },
      { idea: "Frequently Asked Questions with Examples", frame: "Testimonial FAQ", type: "FAQ page", question: "What concerns are common?", priority: "H" },
    ],
    leading: [
      ...(goalPhrase
        ? [{
            // "<Service> for generate qualified enquiries" is ungrammatical —
            // a preposition takes the gerund, never a bare imperative verb.
            query: `${t0} for ${(goalPhrase.gerund || goalPhrase.raw).toLowerCase()}`,
            rationale: "Connects the offer directly to the stated business goal",
            priority: "H",
          }]
        : []),
      { query: `${t0} for decision making`, rationale: "Connects the offer to an urgent practical use", priority: "H" },
      { query: `${t0} results and process`, rationale: "Combines proof and buyer intent", priority: "M" },
    ],
  };
}

function competitorComparison(competitorResults, competitorOpportunities) {
  // Backward-compatible: build basic crawl comparison
  const comparisons = competitorResults.map((item) => {
    if (item.status !== SOURCE_STATUS.AVAILABLE) return { name: item.url, url: item.url, status: "Unavailable", note: item.error };
    const site = item.evidence || {};
    // Guard against thin/hollow evidence from decision-evidence hydration.
    // Some competitor items may have SERP-only metadata without crawl content.
    if (!site.pages && !site.services && !site.pageCount) {
      return { name: item.domain || item.url, url: item.url, status: "Insufficient Evidence", topic: "", offerClarity: "Not Assessed", trustProof: "Not Assessed", ctaClarity: "Not Assessed", contentDepth: "Not Assessed", eeat: "Not Assessed", pathClarity: "Not Assessed" };
    }
    return {
      name: (site.pages || [])[0]?.title || site.domain || item.domain,
      url: item.url,
      topic: (site.services || []).slice(0, 4).join(", ") || (site.topicKeywords || []).slice(0, 4).join(", "),
      offerClarity: (site.services || []).length >= 3 || site.pageCount >= 4 ? "Strong" : (site.services || []).length ? "Moderate" : "Light",
      trustProof: band(scoreTrust(site)),
      ctaClarity: (site.ctas || []).length >= 1 && (site.ctas || []).length <= 8 ? "Strong" : (site.ctas || []).length ? "Moderate" : "Light",
      contentDepth: site.pageCount >= 6 ? "Strong" : site.pageCount >= 3 ? "Moderate" : "Light",
      eeat: band(scoreTrust(site)),
      pathClarity: (site.forms || []).length || (site.ctas || []).length ? "Moderate" : "Light",
    };
  });

  // Attach competitor opportunity layer data
  const oppGaps = competitorOpportunities?.gaps || [];
  const oppQualified = competitorOpportunities?.candidates?.qualified || [];
  const oppExcluded = competitorOpportunities?.candidates?.excluded || [];

  return {
    comparisons,
    opportunities: {
      topics: competitorOpportunities?.topics || [],
      qualifiedCandidates: oppQualified,
      excludedCandidates: oppExcluded,
      gaps: oppGaps,
      allGaps: competitorOpportunities?.allGaps || [],
      sources: competitorOpportunities?.sources || {},
      limitations: competitorOpportunities?.limitations || [],
    },
  };
}

export { buildConversionPaths, topicRows, contentIdeas, competitorComparison };
