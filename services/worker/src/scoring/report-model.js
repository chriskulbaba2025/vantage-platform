import { domainOf } from "../utils.js";
import { band, scoreTrust } from "./score-components.js";

function buildConversionPaths(site) {
  const unique = [];
  const seen = new Set();
  for (const cta of site.ctas) {
    const key = `${cta.text}|${cta.url}`;
    if (!seen.has(key)) { seen.add(key); unique.push(cta); }
  }
  const paths = unique.slice(0, 2).map((cta, index) => {
    let host = "on-site";
    try { if (domainOf(cta.url) !== site.domain) host = new URL(cta.url).hostname; } catch { /* ignore */ }
    const blockers = [];
    if (!site.trust.testimonials && !site.trust.credentials) blockers.push("no trust proof");
    if (!site.trust.pricing) blockers.push("no pricing context");
    if (!site.trust.policies) blockers.push("no policy or next-step reassurance");
    return {
      name: `${index === 0 ? "Primary" : "Secondary"} Path: ${cta.text || "Conversion action"}`,
      cta,
      host,
      steps: ["Land on the relevant page", `Locate “${cta.text || "the call to action"}”`, `Continue through ${host}`, "Complete the requested action"],
      blockers,
      status: blockers.length === 0 ? "Clear" : blockers.length <= 1 ? "Weak" : "Missing support",
    };
  });
  if (!paths.length) paths.push({ name: "Primary conversion path", cta: null, host: "none", steps: ["Land on the website", "Search for a clear next step"], blockers: ["no clear conversion action detected"], status: "Missing" });
  return paths;
}

function topicRows(site) {
  // Prefer validated services; fall back to multi-word topicKeywords only
  const services = site.services.length
    ? site.services
    : site.topicKeywords.filter((t) => t.split(/\s+/).length >= 2).slice(0, 8);
  const pretty = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  return services.slice(0, 8).map((service, index) => ({
    topic: typeof service === "string" ? pretty(service) : String(service),
    stage: index % 3 === 0 ? "TOFU" : index % 3 === 1 ? "MOFU" : "BOFU",
    blocker: !site.trust.credentials ? "Doubt" : !site.trust.pricing ? "Offer clarity" : "Unclear next step",
    trustAsset: !site.trust.credentials ? "Credential" : !site.trust.testimonials ? "Testimonial" : "Process proof",
    eeat: !site.trust.credentials ? "Expertise proof" : "Experience proof",
    cta: site.forms.length ? "Form" : "Book",
    path: site.ctas.length ? "Weak" : "Missing",
    priority: index < 4 ? "H" : index < 7 ? "M" : "L",
  }));
}

function contentIdeas(site) {
  // Build topics from validated services and multi-word topicKeywords.
  // Single short words (like "foot") are rejected because they produce
  // nonsensical content ideas such as "What Is Foot?".
  const candidates = [
    ...site.services,
    ...site.topicKeywords.filter((t) => t.split(/\s+/).length >= 2),
  ];
  const deduped = [...new Set(candidates.map((s) => s.toLowerCase()))];
  const topics = deduped.slice(0, 3);

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
      { idea: "Your First Step", frame: "Process page", type: "Start-here", question: "What happens after I act?", priority: "H" },
      { idea: "Frequently Asked Questions with Examples", frame: "Testimonial FAQ", type: "FAQ page", question: "What concerns are common?", priority: "H" },
    ],
    leading: [
      { query: `${t0} for decision making`, rationale: "Connects the offer to an urgent practical use", priority: "H" },
      { query: `${t0} results and process`, rationale: "Combines proof and buyer intent", priority: "M" },
    ],
  };
}

function competitorComparison(competitorResults) {
  return competitorResults.map((item) => {
    if (item.status !== "complete") return { name: item.url, url: item.url, status: "Unavailable", note: item.error };
    const site = item.evidence;
    return {
      name: site.pages[0]?.title || site.domain,
      url: item.url,
      topic: site.services.slice(0, 4).join(", ") || site.topicKeywords.slice(0, 4).join(", "),
      offerClarity: site.services.length >= 3 || site.pageCount >= 4 ? "Strong" : site.services.length ? "Moderate" : "Light",
      trustProof: band(scoreTrust(site)),
      ctaClarity: site.ctas.length >= 1 && site.ctas.length <= 8 ? "Strong" : site.ctas.length ? "Moderate" : "Light",
      contentDepth: site.pageCount >= 6 ? "Strong" : site.pageCount >= 3 ? "Moderate" : "Light",
      eeat: band(scoreTrust(site)),
      pathClarity: site.forms.length || site.ctas.length ? "Moderate" : "Light",
    };
  });
}

export { buildConversionPaths, topicRows, contentIdeas, competitorComparison };
