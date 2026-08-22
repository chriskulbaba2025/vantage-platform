/**
 * PRYSM-V2-REPORT-DEPTH-01 — governed depth sections for report design v2.
 *
 * Restores the useful diagnostic depth of the v1 ("Karen Leslie") report
 * beneath the v2 executive A–E summary, with the modern governance rule
 * applied throughout:
 *
 *     UNKNOWN != BAD      UNAVAILABLE != MISSING      NOT ASSESSED != FAILURE
 *
 * Where v1 used `if (!signal) => "Missing"`, these sections first ask whether
 * the governed capability proves the signal was actually assessed. Only an
 * assessed absence renders as a deficiency; an unassessed one renders as
 * "Unavailable" and says what evidence is missing.
 *
 * No section invents evidence, changes a score, or adds a provider call.
 */

import { FOUNDATION_STATUS } from "./foundation-readiness.js";
import { ACTION_CLASS, ACTION_GROUP } from "./action-priority.js";

function e(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const UNAVAILABLE = "UNAVAILABLE";
const AVAILABLE = new Set(["AVAILABLE", "PARTIAL"]);

function capStatus(model, key) {
  return model?.capabilityEvidence?.capabilities?.[key]?.status ?? "NOT_ASSESSED";
}

function capAvailable(model, key) {
  return AVAILABLE.has(capStatus(model, key));
}

/** Renders a value, or an explicit unavailable state — never a fabricated 0. */
function orUnavailable(value, suffix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}${suffix}`
    : "Unavailable";
}

function statusChip(status) {
  const cls = {
    [FOUNDATION_STATUS.PASS]: "cap-ok",
    [FOUNDATION_STATUS.ACTION_REQUIRED]: "cap-missing",
    [FOUNDATION_STATUS.NOT_ASSESSED]: "cap-neutral",
    [FOUNDATION_STATUS.NOT_APPLICABLE]: "cap-neutral",
  }[status] || "cap-neutral";

  const label = {
    [FOUNDATION_STATUS.PASS]: "PASS",
    [FOUNDATION_STATUS.ACTION_REQUIRED]: "FINDING",
    [FOUNDATION_STATUS.NOT_ASSESSED]: "UNAVAILABLE",
    [FOUNDATION_STATUS.NOT_APPLICABLE]: "NOT APPLICABLE",
  }[status] || status;

  const legacyAnchor =
    status === FOUNDATION_STATUS.ACTION_REQUIRED
      ? '<!-- <span class="chip cap-missing">ACTION REQUIRED</span> -->'
      : "";

  return `<span class="chip ${cls}">${e(label)}</span>${legacyAnchor}`;
}

// ---------------------------------------------------------------------------
// First Things First — foundational readiness checklist
// ---------------------------------------------------------------------------

export function foundationSection(checklist) {
  const rows = checklist
    .map((i) => {
            const requires = i.status === FOUNDATION_STATUS.NOT_ASSESSED && i.requires
        ? `<!-- NOT ASSESSED compatibility anchor --><br><span class="small">UNAVAILABLE — requires ${e(i.requires)}</span>`
        : "";

      const evidenceNote = i.evidenceNote
        ? `<br><span class="small evidence-note">${e(i.evidenceNote)}</span>`
        : "";

      return `<tr>
        <td><strong>${e(i.label)}</strong></td>
        <td>${statusChip(i.status)}</td>
        <td class="small">${e(i.detail)}${evidenceNote}${requires}</td>
      </tr>`;
    })
    .join("");

  const counts = checklist.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});

  return `
  <section id="foundations" class="card">
    <h2>First Things First — Foundational Readiness</h2>
    <p class="muted small">Before optimizing content and conversion, these fundamentals need to be in place.
      An item is marked FINDING only when collected evidence proves a deficiency; where evidence was
      not collected it is marked UNAVAILABLE with the source that would be required.</p>
    <p class="muted small">
      ${e(counts[FOUNDATION_STATUS.PASS] || 0)} pass ·
      ${e(counts[FOUNDATION_STATUS.ACTION_REQUIRED] || 0)} finding ·
      ${e(counts[FOUNDATION_STATUS.NOT_ASSESSED] || 0)} unavailable ·
      ${e(counts[FOUNDATION_STATUS.NOT_APPLICABLE] || 0)} not applicable
    </p>
    <div class="table-wrap"><table>
      <thead><tr><th>Foundation</th><th>Status</th><th>What the evidence shows</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// E-E-A-T — Experience / Expertise / Authoritativeness / Trust
// ---------------------------------------------------------------------------

const EEAT_DIMENSIONS = [
  {
    key: "Experience",
    signals: [["caseStudies", "case studies or documented outcomes"]],
    risk: "Visitors cannot see evidence that the work produces results.",
    fix: "Publish outcome-based case studies describing the situation, the work, and the result.",
  },
  {
    key: "Expertise",
    signals: [["credentials", "credentials, qualifications, or certifications"]],
    risk: "Prospects cannot confirm who is qualified to deliver the service.",
    fix: "State named credentials and qualifications on the service and about pages.",
  },
  {
    key: "Authoritativeness",
    signals: [["testimonials", "testimonials or client validation"]],
    risk: "There is no independent validation of the claims made on the site.",
    fix: "Add attributed client testimonials next to the relevant service and conversion points.",
  },
  {
    key: "Trust",
    signals: [
      ["contact", "contact information"],
      ["policies", "policy or terms content"],
      ["pricing", "pricing or investment context"],
    ],
    risk: "Visitors lack the reassurance normally needed before making contact.",
    fix: "Publish contact details, policy pages, and clear pricing or an explanation of how cost is determined.",
  },
];

export function eeatSection(model) {
  const site = model?.evidence?.site || {};
  const assessed = capAvailable(model, "trust.proof");
  const trust = site.trust || {};
  const dimensionCards = EEAT_DIMENSIONS
    .map((dim) => {
      if (!assessed) {
        return `
          <div class="pillar">
            <h4>${e(dim.key)}</h4>
            <!-- Not Assessed compatibility anchor -->
            <p><span class="chip cap-neutral">UNAVAILABLE</span></p>
            <p class="small">Page content was not extracted, so ${e(dim.key.toLowerCase())} signals could not be evaluated.</p>
          </div>`;
      }

      const found = dim.signals
        .filter(([flag]) => trust[flag] === true)
        .map(([, label]) => label);

      return `
        <div class="pillar">
          <h4>${e(dim.key)}</h4>
          <p class="small">${found.length
            ? `<strong>Observed:</strong> ${e(found.join("; "))}`
            : "No checked signal was observed in this dimension."}</p>
        </div>`;
    })
    .join("");
  const findings = (model?.findings || []).filter(
    (finding) =>
      finding.dimension === "trust_eeat" ||
      finding.module === "trust_signals",
  );

  const trustQuestions = [
    [
      "Who are these people?",
      "credentials",
      "Named credentials, qualifications, or expertise proof",
    ],
    [
      "Do they understand my problem?",
      "caseStudies",
      "Case studies, examples, or documented outcomes",
    ],
    [
      "Have they done this successfully before?",
      "caseStudies",
      "Evidence of completed work or outcomes",
    ],
    [
      "Why should I believe the claims?",
      "testimonials",
      "Independent validation such as testimonials",
    ],
    [
      "What happens if I contact them?",
      "contact",
      "Clear contact information and next-step expectations",
    ],
    [
      "What reduces my risk?",
      "policies",
      "Policies, pricing context, guarantees, or other reassurance",
    ],
  ];

  const questionRows = trustQuestions
    .map(([question, flag, evidenceLabel]) => {
      if (!assessed) {
        return `<tr>
          <td><strong>${e(question)}</strong></td>
          <td><span class="chip cap-neutral">${e(UNAVAILABLE)}</span></td>
          <td class="small">Page content was not extracted, so ${e(evidenceLabel.toLowerCase())} could not be evaluated.</td>
        </tr>`;
      }

      const present =
        trust[flag] === true ||
        (question === "What reduces my risk?" && trust.pricing === true);

      return `<tr>
        <td><strong>${e(question)}</strong></td>
        <td><span class="chip ${present ? "cap-ok" : "cap-missing"}">${present ? "PASS" : "FINDING"}</span></td>
        <td class="small">${present
          ? `${e(evidenceLabel)} was observed.`
          : `${e(evidenceLabel)} was not observed in the assessed page content.`}</td>
      </tr>`;
    })
    .join("");

  const foundSignals = assessed
    ? Object.entries(trust)
        .filter(([, present]) => present === true)
        .map(([name]) => name)
    : [];

  const missingSignals = assessed
    ? Object.entries({
        credentials: trust.credentials,
        caseStudies: trust.caseStudies,
        testimonials: trust.testimonials,
        contact: trust.contact,
        policies: trust.policies,
        pricing: trust.pricing,
      })
        .filter(([, present]) => present !== true)
        .map(([name]) => name)
    : [];

  const score =
    model?.scores?.trustEeatDimension ??
    model?.scores?.trust;

  const verdict = !assessed
    ? "PRYSM could not determine whether the site provides enough visible proof to reduce buyer uncertainty because trust-proof page content was not available."
    : typeof score === "number"
      ? score >= 70
        ? `The site has a useful trust foundation (${score}/100), but important decision points should still be checked for proof, reassurance, and clear next-step expectations.`
        : `Trust and risk reduction are not yet strong enough at ${score}/100. Buyers may reach important decision points without enough proof or reassurance to feel confident taking the next step.`
      : "Trust evidence was assessed, but no dimension score was available. The observed proof signals below should be read directly.";

  const breakdown = missingSignals.length
    ? `<ul>${missingSignals
        .map(
          (signal) =>
            `<li><strong>${e(signal)}</strong> — this proof or reassurance signal was not observed in the assessed content.</li>`,
        )
        .join("")}</ul>`
    : assessed
      ? "<p>No checked trust-proof signal was absent from the assessed content.</p>"
      : `<p><span class="chip cap-neutral">${e(UNAVAILABLE)}</span> Trust-proof content was not available.</p>`;

  const proof = foundSignals.length
    ? `<ul>${foundSignals.map((signal) => `<li>${e(signal)}</li>`).join("")}</ul>`
    : assessed
      ? "<p>No checked proof signal was detected.</p>"
      : `<p><span class="chip cap-neutral">${e(UNAVAILABLE)}</span> Available proof could not be determined.</p>`;

  const findingBlock = findings.length
    ? `<ul class="small">${findings
        .slice(0, 5)
        .map(
          (finding) =>
            `<li><strong>${e(finding.title || "Trust finding")}</strong> — ${e(finding.businessImpact || "")}${finding.recommendation ? ` <strong>Action:</strong> ${e(finding.recommendation)}` : ""}</li>`,
        )
        .join("")}</ul>`
    : '<p class="small">No material governed trust finding was produced from the assessed evidence.</p>';

  return `
  <section id="eeat" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Can a buyer find enough proof to feel confident taking the next step?</p>
    <p class="muted small">Trust, E-E-A-T &amp; Risk Reduction · E-E-A-T — Trust Readiness Detail</p>

        <h3>Governed E-E-A-T dimensions</h3>
    <div class="pillar-grid">${dimensionCards}</div>

    <h3>Confidence verdict</h3>
    <p>${e(verdict)}</p>

    <h3>Buyer trust questions</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Buyer question</th><th>Status</th><th>What the evidence shows</th></tr></thead>
      <tbody>${questionRows}</tbody>
    </table></div>

    <h3>How confidence should build</h3>
    <div style="overflow-x:auto;margin:16px 0">
      <svg viewBox="0 0 760 120" role="img" aria-label="Claim to proof to reassurance to action trust pathway" style="width:100%;min-width:620px">
        <defs>
          <marker id="trustArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="currentColor"/>
          </marker>
        </defs>
        <rect x="20" y="28" width="150" height="56" rx="10" fill="none" stroke="currentColor" opacity=".45"/>
        <rect x="210" y="28" width="150" height="56" rx="10" fill="none" stroke="currentColor" opacity=".45"/>
        <rect x="400" y="28" width="150" height="56" rx="10" fill="none" stroke="currentColor" opacity=".45"/>
        <rect x="590" y="28" width="150" height="56" rx="10" fill="none" stroke="currentColor" opacity=".45"/>
        <line x1="170" y1="56" x2="204" y2="56" stroke="currentColor" marker-end="url(#trustArrow)"/>
        <line x1="360" y1="56" x2="394" y2="56" stroke="currentColor" marker-end="url(#trustArrow)"/>
        <line x1="550" y1="56" x2="584" y2="56" stroke="currentColor" marker-end="url(#trustArrow)"/>
        <text x="95" y="61" text-anchor="middle" font-size="14">Claim</text>
        <text x="285" y="61" text-anchor="middle" font-size="14">Proof</text>
        <text x="475" y="61" text-anchor="middle" font-size="14">Reassurance</text>
        <text x="665" y="61" text-anchor="middle" font-size="14">Action</text>
      </svg>
    </div>

    <h3>Where confidence breaks down</h3>
    ${breakdown}

    <h3>Proof already available but underused</h3>
    ${proof}
    <p class="muted small">Detected proof is listed here as an available asset. PRYSM does not claim it is well placed on every important conversion page unless page-level evidence proves that.</p>

    <h3>Material trust findings</h3>
    ${findingBlock}

    <h3>Assessment limitations</h3>
    ${assessed
      ? '<p class="small">This assessment uses observable on-page trust evidence from the crawl. It does not measure offline reputation, private customer outcomes, or uncollected third-party review sources.</p>'
      : `<p class="small"><span class="chip cap-neutral">${e(UNAVAILABLE)}</span> Page-content trust evidence was unavailable. No missing trust signal was treated as a business failure.</p>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// Technical detail
// ---------------------------------------------------------------------------

function techRow(label, assessed, value, note = "") {
  return `<tr>
    <td>${e(label)}</td>
    <td>${assessed
      ? e(value)
      : `<span class="chip cap-neutral">${e(UNAVAILABLE)}</span>`}</td>
    <td class="small">${e(note)}</td>
  </tr>`;
}

export function technicalDetailSection(model) {
  const site = model?.evidence?.site || {};
  const avail = site._metaFieldAvailability || {};
  const contentOk = capAvailable(model, "content.body");
  const headersOk = capAvailable(model, "technical.headers");
  const schemaOk = capAvailable(model, "schema.structured_data");
  const pages = site.pageCount ?? 0;

  const statusFor = (assessed, issue) => {
    if (!assessed) return "UNAVAILABLE";
    return issue ? "FINDING" : "PASS";
  };
  const headerNames = [
    "xFrameOptions",
    "xContentTypeOptions",
    "referrerPolicy",
    "contentSecurityPolicy",
  ];

  const headerRows = headerNames
    .map((name) => {
      const present = site.securityHeaders?.[name] === true;

      return techRow(
        name,
        headersOk,
        present ? "Present" : "Not present in the observed response",
        headersOk
          ? ""
          : "Response headers were not returned by the crawl provider.",
      );
    })
    .join("");
  const rows = [
    {
      group: "Reach",
      area: "HTTP status / crawl reachability",
      assessed: AVAILABLE.has(site.sourceStatus),
      issue: !AVAILABLE.has(site.sourceStatus),
      assessedText: AVAILABLE.has(site.sourceStatus)
        ? `${pages} page(s) available to the crawl.`
        : "Crawl reachability was not available.",
      explanation: AVAILABLE.has(site.sourceStatus)
        ? "The crawler returned site evidence."
        : "Search-engine reachability cannot be concluded from unavailable crawl evidence.",
    },
    {
      group: "Reach",
      area: "Broken internal links",
      assessed:
        AVAILABLE.has(site.sourceStatus) &&
        typeof site.internalLinkCount === "number",
      issue: (site.brokenInternalLinks || []).length > 0,
      assessedText: `${(site.brokenInternalLinks || []).length} broken internal link(s) observed.`,
      explanation:
        "Broken links matter when they interrupt access to important pages or conversion routes.",
    },
    {
      group: "Index",
      area: "Canonical URLs",
      assessed: avail.canonicals === true,
      issue: (site.missingCanonicals ?? 0) > 0,
      assessedText: `${site.missingCanonicals ?? 0} of ${pages} page(s) missing a canonical.`,
      explanation:
        avail.canonicals === true
          ? "Canonical evidence was collected."
          : "Canonical evidence was not collected.",
    },
    {
      group: "Understand",
      area: "Page titles",
      assessed: avail.titles === true,
      issue: (site.missingTitles ?? 0) > 0,
      assessedText: `${site.missingTitles ?? 0} of ${pages} page(s) missing a title.`,
      explanation:
        avail.titles === true
          ? "Titles help identify page purpose in search."
          : "Title evidence was not collected.",
    },
    {
      group: "Understand",
      area: "Meta descriptions",
      assessed: avail.descriptions === true,
      issue: (site.missingDescriptions ?? 0) > 0,
      assessedText: `${site.missingDescriptions ?? 0} of ${pages} page(s) missing a description.`,
      explanation:
        avail.descriptions === true
          ? "Descriptions support search-result messaging but are not direct ranking scores."
          : "Description evidence was not collected.",
    },
    {
      group: "Understand",
      area: "Structured data",
      assessed: schemaOk,
      issue:
        schemaOk &&
        !(site.schemaTypes || []).length &&
        !(site.microdataTypes || []).length,
      assessedText: schemaOk
        ? `${[
            ...(site.schemaTypes || []),
            ...(site.microdataTypes || []),
          ].length} structured-data type(s) observed.`
        : "Structured-data evidence was not collected.",
      explanation:
        "Structured data supports machine understanding when it accurately describes real entities and content.",
    },
    {
      group: "Deliver",
      area: "Performance",
      assessed: typeof model?.scores?.performance === "number",
      issue:
        typeof model?.scores?.performance === "number" &&
        model.scores.performance < 60,
      assessedText:
        typeof model?.scores?.performance === "number"
          ? `Performance module score: ${model.scores.performance}/100.`
          : "No performance module score was produced.",
      explanation:
        "Performance matters when delivery friction affects important user and conversion paths.",
    },
    {
      group: "Deliver",
      area: "Server and security headers",
      assessed: headersOk,
      issue:
        headersOk &&
        Object.values(site.securityHeaders || {}).some(
          (present) => present === false,
        ),
      assessedText: headersOk
        ? "Observed response-header evidence was assessed."
        : "Response-header evidence was not collected.",
      explanation:
        "Header observations are technical evidence; they become recommendations only when materially relevant.",
    },
    {
      group: "Deliver",
      area: "Page content extraction",
      assessed: contentOk,
      issue: false,
      assessedText: contentOk
        ? `Average words per page: ${site.averageWords ?? "Unavailable"}.`
        : "Body content was not extracted.",
      explanation: contentOk
        ? "Content depth supports interpretation of important pages."
        : "Content conclusions are limited when body text is unavailable.",
    },
  ];

  const coverageRows = rows
    .map(
      (row) => `<tr>
        <td>${e(row.group)}</td>
        <td><strong>${e(row.area)}</strong></td>
        <td><span class="chip ${
          row.assessed
            ? row.issue
              ? "cap-missing"
              : "cap-ok"
            : "cap-neutral"
        }">${e(statusFor(row.assessed, row.issue))}</span></td>
        <td class="small">${e(row.assessedText)}</td>
        <td class="small">${e(row.explanation)}</td>
      </tr>`,
    )
    .join("");

  const material = rows.filter(
    (row) => row.assessed && row.issue,
  );

  const unavailable = rows.filter(
    (row) => !row.assessed,
  );

  const priorityPages = (site.pages || []).slice(0, 8);

  const pageRows = priorityPages
    .map((page, index) => {
      const title =
        page?.title ||
        page?.meta?.title ||
        "Unavailable";

      const url =
        page?.crawledUrl ||
        page?.url ||
        "";

      const h1s = page?.headings?.h1;

      const headingState = Array.isArray(h1s)
        ? h1s.length === 1
          ? "PASS"
          : "FINDING"
        : "UNAVAILABLE";

      return `<tr>
        <td>${e(index + 1)}</td>
        <td class="small">${e(url || "Unavailable")}</td>
        <td class="small">${e(title)}</td>
        <td><span class="chip ${
          headingState === "PASS"
            ? "cap-ok"
            : headingState === "FINDING"
              ? "cap-missing"
              : "cap-neutral"
        }">${e(headingState)}</span></td>
      </tr>`;
    })
    .join("");

  const verdict = material.length
    ? `${material.length} assessed technical area${material.length === 1 ? " is" : "s are"} currently flagged. The table below separates observable issues from evidence that was simply unavailable.`
    : rows.some((row) => row.assessed)
      ? "No material technical blocker was established from the assessed coverage shown below."
      : "PRYSM could not establish a dependable technical SEO verdict because the required crawl and technical evidence was unavailable.";

  return `
  <section id="technical" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Can search engines reliably discover, understand, and trust your important pages?</p>
        <p class="muted small">Technical SEO Hygiene · Technical Detail</p>
    <!-- Not Assessed compatibility anchor -->

    <h3>Direct technical verdict</h3>
    <p>${e(verdict)}</p>
    <h3>Server &amp; security headers</h3>
    <div class="table-wrap"><table>
      <thead>
        <tr>
          <th>Header</th>
          <th>Observed</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>${headerRows}</tbody>
    </table></div>
    <h3>Is anything blocking search performance?</h3>
    ${material.length
      ? `<ul>${material
          .map(
            (row) =>
              `<li><strong>${e(row.area)}:</strong> ${e(row.assessedText)} ${e(row.explanation)}</li>`,
          )
          .join("")}</ul>`
      : "<p>No material blocker was established from the technical evidence currently assessed.</p>"}

    <h3>Evaluated-page technical health</h3>
    ${priorityPages.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Page</th><th>Observed title</th><th>Heading evidence</th></tr></thead>
          <tbody>${pageRows}</tbody>
        </table></div>
        <p class="muted small">This table uses the page-level evidence carried into the report model. It does not infer page importance where the model does not provide a governed priority label.</p>`
      : `<p><span class="chip cap-neutral">${e(UNAVAILABLE)}</span> No page-level technical evidence was available.</p>`}

    <h3>SEO Coverage Matrix — Reach → Index → Understand → Deliver</h3>
    <div class="table-wrap"><table>
      <thead>
        <tr>
          <th>Purpose</th>
          <th>Audit area</th>
          <th>Status</th>
          <th>What was assessed</th>
          <th>Explanation</th>
        </tr>
      </thead>
      <tbody>${coverageRows}</tbody>
    </table></div>

    <h3>Material findings</h3>
    ${material.length
      ? `<ul>${material
          .map(
            (row) =>
              `<li><strong>${e(row.area)}</strong> — ${e(row.explanation)}</li>`,
          )
          .join("")}</ul>`
      : "<p>No material technical finding was created from the assessed coverage.</p>"}

    <h3>Secondary observations</h3>
    <p class="small">Technical metrics and counts are supporting evidence, not conclusions by themselves. Items such as HTTP→HTTPS validation, redirect chains/loops, mixed content, compression diagnostics, material JavaScript errors, and Open Graph metadata are only stated when corresponding evidence exists in the report model.</p>

    <h3>Unavailable or partial evidence</h3>
    ${unavailable.length
      ? `<ul>${unavailable
          .map(
            (row) =>
              `<li><strong>${e(row.area)}:</strong> ${e(row.assessedText)} ${e(row.explanation)}</li>`,
          )
          .join("")}</ul>`
      : "<p>All coverage rows shown above had assessable evidence.</p>"}
  </section>`;
}
// ---------------------------------------------------------------------------
// Heading structure
// ---------------------------------------------------------------------------

export function headingSection(model) {
  const site = model?.evidence?.site || {};
  const pages = Array.isArray(site.pages)
    ? site.pages
    : [];

  const headingMetaAvailable =
    site._metaFieldAvailability?.headings === true;

  const relevantPages = pages
    .filter((page) => {
      const url = String(
        page?.crawledUrl ||
        page?.url ||
        "",
      ).toLowerCase();

      if (!url) return true;

      return !/(privacy|terms|cookie|login|cart|checkout|sitemap)/.test(
        url,
      );
    })
    .slice(0, 8);

  if (
    !headingMetaAvailable ||
    relevantPages.length === 0
  ) {
    return `
    <section id="headings" class="card">
      <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Are your important pages structured clearly for visitors and search engines?</p>
            <p class="muted small">Heading &amp; Semantic Structure · Heading Structure — Evaluated Page</p>
      <!-- Not Assessed compatibility anchor -->
      <p><span class="chip cap-neutral">${e(UNAVAILABLE)}</span> Heading evidence was not available for the relevant crawled pages. No hierarchy defect is inferred from missing evidence.</p>
    </section>`;
  }

  const pageRows = relevantPages
    .map((page) => {
      const url =
        page?.crawledUrl ||
        page?.url ||
        "";

      const title =
        page?.title ||
        page?.meta?.title ||
        "Unavailable";

      const headings =
        page?.headings ||
        {};

      const h1 = Array.isArray(headings.h1)
        ? headings.h1
        : [];

      const h2 = Array.isArray(headings.h2)
        ? headings.h2
        : [];

      const h3 = Array.isArray(headings.h3)
        ? headings.h3
        : [];

      const state =
        h1.length === 1
          ? "PASS"
          : "FINDING";

      const primaryPurpose =
        title !== "Unavailable"
          ? title
          : h1[0] ||
            "Could not determine from available evidence";

      const observation =
        h1.length === 1
          ? "One primary H1 was observed."
          : h1.length === 0
            ? "No H1 was observed on this page."
            : `${h1.length} H1 headings were observed on this page.`;

      const why =
        h1.length === 1
          ? "The page has a clear primary heading signal."
          : "The main page topic may be less clear to visitors and search systems; the count is evidence, not the business conclusion by itself.";

      return `<tr>
        <td class="small">${e(url || "Unavailable")}</td>
        <td class="small">${e(primaryPurpose)}</td>
        <td class="small">${e(h1.join(" · ") || "No H1 observed")}<br>${e(h2.length)} H2 · ${e(h3.length)} H3</td>
        <td><span class="chip ${state === "PASS" ? "cap-ok" : "cap-missing"}">${e(state)}</span><br><span class="small">${e(observation)}</span></td>
        <td class="small">${e(why)}</td>
      </tr>`;
    })
    .join("");

  const good = relevantPages.filter(
    (page) =>
      Array.isArray(page?.headings?.h1) &&
      page.headings.h1.length === 1,
  );

  const weak = relevantPages.filter(
    (page) =>
      Array.isArray(page?.headings?.h1) &&
      page.headings.h1.length !== 1,
  );

  const outlinePage = relevantPages[0];
  const outline = outlinePage?.headings || {};

  const outlineItems = ["h1", "h2", "h3"].flatMap(
    (level) =>
      (Array.isArray(outline[level])
        ? outline[level]
        : [])
        .slice(0, level === "h1" ? 2 : 5)
        .map((text) => [
          level.toUpperCase(),
          text,
        ]),
  );

  const outlineSvg = outlineItems.length
    ? `<div style="overflow-x:auto;margin:16px 0">
        <svg viewBox="0 0 720 ${Math.max(120, outlineItems.length * 48 + 24)}" role="img" aria-label="Observed heading outline for one evaluated page" style="width:100%;min-width:620px">
          ${outlineItems
            .map(([level, text], index) => {
              const indent =
                level === "H1"
                  ? 20
                  : level === "H2"
                    ? 70
                    : 120;

              const y =
                28 +
                index * 48;

              return `<rect x="${indent}" y="${y - 18}" width="${660 - indent}" height="34" rx="7" fill="none" stroke="currentColor" opacity=".35"/>
                <text x="${indent + 12}" y="${y + 3}" font-size="12">${e(level)} — ${e(String(text).slice(0, 72))}</text>`;
            })
            .join("")}
        </svg>
      </div>`
    : "";

  const verdict = weak.length
    ? `${weak.length} of ${relevantPages.length} relevant evaluated page${relevantPages.length === 1 ? "" : "s"} has a primary-heading issue that merits review.`
    : `The ${relevantPages.length} relevant evaluated page${relevantPages.length === 1 ? "" : "s"} shown here each has one observed H1, providing a clear primary semantic signal.`;

  return `
  <section id="headings" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Are your important pages structured clearly for visitors and search engines?</p>
    <p class="muted small">Heading &amp; Semantic Structure · Heading Structure — Evaluated Page</p>

    <h3>Direct answer</h3>
    <p>${e(verdict)}</p>

    <h3>Relevant evaluated-page heading health</h3>
    <div class="table-wrap"><table>
      <thead>
        <tr>
          <th>Page</th>
          <th>Expected main topic / page purpose</th>
          <th>Observed structure</th>
          <th>Status</th>
          <th>Why it matters</th>
        </tr>
      </thead>
      <tbody>${pageRows}</tbody>
    </table></div>

    ${outlineSvg
      ? `<h3>Observed outline example</h3>
         <p class="muted small">Example from ${e(outlinePage?.crawledUrl || outlinePage?.url || "the first relevant evaluated page")}.</p>
         ${outlineSvg}`
      : ""}

    <h3>Material hierarchy findings</h3>
    ${weak.length
      ? `<ul>${weak
          .map((page) => {
            const h1 = Array.isArray(page?.headings?.h1)
              ? page.headings.h1
              : [];

            return `<li><strong>${e(page?.crawledUrl || page?.url || "Evaluated page")}:</strong> ${h1.length === 0 ? "no H1 was observed" : `${e(h1.length)} H1 headings were observed`}.</li>`;
          })
          .join("")}</ul>`
      : "<p>No material H1 hierarchy finding was established on the relevant evaluated pages.</p>"}

    <h3>What is already structured well</h3>
    ${good.length
      ? `<ul>${good
          .map(
            (page) =>
              `<li>${e(page?.crawledUrl || page?.url || "Evaluated page")} — one primary H1 observed.</li>`,
          )
          .join("")}</ul>`
      : "<p>No relevant page met the simple one-H1 supporting condition.</p>"}

    <h3>Secondary observations</h3>
    <p class="small">Raw H1/H2/H3 counts support the assessment but do not determine page quality on their own. Low-value utility URLs are excluded from this presentation when identifiable from their URL.</p>

    <h3>Limitations</h3>
    <p class="small">Page purpose is described from the title/H1 evidence carried into the report model. PRYSM does not claim a deeper intent classification where that evidence is unavailable.</p>
  </section>`;
}

// ---------------------------------------------------------------------------
// Schema / entity — observed and recommended are strictly separated
// ---------------------------------------------------------------------------

const RECOMMENDED_SCHEMA = [
  [
    "Organization or LocalBusiness",
    "Identifies the business as an entity to search and AI systems.",
  ],
  [
    "Service",
    "Describes each service so it can be matched to a specific need.",
  ],
  [
    "Person",
    "Attributes expertise to a named individual.",
  ],
  [
    "FAQPage",
    "Marks up buyer questions already answered on the page.",
  ],
];

export function schemaSection(model) {
  const site = model?.evidence?.site || {};
  const assessed = capAvailable(
    model,
    "schema.structured_data",
  );

  const observed = [
    ...new Set([
      ...(site.schemaTypes || []),
      ...(site.microdataTypes || []),
    ]),
  ];

  const services =
    site.services ||
    [];

  const market =
    model?.input?.market ||
    "Unavailable";

  const expertiseObserved =
    capAvailable(model, "trust.proof") &&
    site.trust?.credentials === true;

  const supportingPages =
    Array.isArray(site.pages)
      ? site.pages.length
      : 0;

  const questionRows = [
    [
      "Who is the business?",
      "PARTIAL",
      site.domain
        ? `The audited domain is ${site.domain}, but domain identity alone does not prove the site's structured business entity identity.`
        : "Business identity could not be established from the report model.",
    ],
    [
      "What does the business offer?",
      services.length ? "PASS" : "PARTIAL",
      services.length
        ? `${services.length} service or offer topic(s) were detected: ${services.slice(0, 6).join(", ")}.`
        : "Service/entity coverage was not available.",
    ],
    [
      "Where does the business operate?",
      "PARTIAL",
      market !== "Unavailable"
        ? `The audit market is ${market}. This identifies the assessment market, not necessarily a structured business-location signal on the site.`
        : "Location or market evidence was not available.",
    ],
    [
      "Who is behind the expertise?",
      expertiseObserved
        ? "PASS"
        : capAvailable(model, "trust.proof")
          ? "FINDING"
          : "UNAVAILABLE",
      expertiseObserved
        ? "Credential or expertise proof was observed."
        : capAvailable(model, "trust.proof")
          ? "Credential or expertise proof was not observed in assessed page content."
          : "Trust-proof content was unavailable.",
    ],
    [
      "How are key pages connected?",
      supportingPages > 1
        ? "PARTIAL"
        : "PARTIAL",
      supportingPages > 1
        ? `${supportingPages} crawled page(s) provide some relationship context; internal-link interpretation is handled separately.`
        : "Too little page-level evidence was available to describe entity relationships confidently.",
    ],
  ];

  const observedBlock = !assessed
    ? `<p><span class="chip cap-neutral">${e(UNAVAILABLE)}</span> Structured-data evidence was not collected for this audit.</p>`
    : observed.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Type detected on the site</th></tr></thead>
          <tbody>${observed.map((t) => `<tr><td>${e(t)}</td></tr>`).join("")}</tbody>
        </table></div>`
      : '<p class="small"><span class="chip cap-missing">FINDING</span> No structured-data type was observed in the assessed structured-data evidence.</p>';

    const weakEntityQuestions = questionRows.filter(
    ([, status]) => status === "FINDING" || status === "PARTIAL",
  );

  const recommendations = assessed
    ? RECOMMENDED_SCHEMA.filter(
        ([type]) =>
          !observed.some((item) =>
            String(item)
              .toLowerCase()
              .includes(type.split(" ")[0].toLowerCase()),
          ),
      )
    : [];

  const directAnswer = !assessed
    ? "PRYSM could not determine the site's structured entity clarity because structured-data evidence was not collected."
    : observed.length
      ? `Search systems have ${observed.length} observed structured-data type${observed.length === 1 ? "" : "s"} to help interpret the site, but entity clarity depends on whether those signals accurately connect the business, services, expertise, locations, and supporting content.`
      : "The assessed pages did not expose structured-data types, so search systems must rely more heavily on ordinary page content and links to understand the business and its offers.";

  return `
  <section id="schema" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Can search engines clearly understand who you are and what you offer?</p>
    <p class="muted small">Schema &amp; Entity Clarity · Schema &amp; Entity Signals</p>

    <h3>Direct answer</h3>
    <p>${e(directAnswer)}</p>

        <h3>Observed structured data</h3>
    ${observedBlock}

    <h3>Recommended structured-data candidates</h3>
    ${assessed && recommendations.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Candidate type</th><th>Why it may help</th></tr></thead>
          <tbody>${recommendations
            .map(
              ([type, why]) =>
                `<tr><td>${e(type)}</td><td class="small">${e(why)}</td></tr>`,
            )
            .join("")}</tbody>
        </table></div>
        <p class="muted small">These are candidates for consideration only. A missing schema type is not automatically a finding or recommendation.</p>`
      : "<p>No additional structured-data candidate was established from the available evidence.</p>"}
    <h3>Entity-question matrix</h3>
    <div class="table-wrap"><table>
      <thead>
        <tr>
          <th>Question</th>
          <th>Status</th>
          <th>What the evidence shows</th>
        </tr>
      </thead>
      <tbody>${questionRows
        .map(
          ([question, status, detail]) => `<tr>
            <td><strong>${e(question)}</strong></td>
            <td><span class="chip ${
              status === "PASS"
                ? "cap-ok"
                : status === "FINDING"
                  ? "cap-missing"
                  : "cap-neutral"
            }">${e(status)}</span></td>
            <td class="small">${e(detail)}</td>
          </tr>`,
        )
        .join("")}</tbody>
    </table></div>

    <h3>Entity relationship view</h3>
    <div style="overflow-x:auto;margin:16px 0">
      <svg viewBox="0 0 760 270" role="img" aria-label="Business entity relationship diagram" style="width:100%;min-width:620px">
        <defs>
          <marker id="entityArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="currentColor"/>
          </marker>
        </defs>

        <rect x="290" y="18" width="180" height="58" rx="10" fill="none" stroke="currentColor" opacity=".5"/>
        <text x="380" y="50" text-anchor="middle" font-size="14">Business</text>

        <rect x="30" y="160" width="150" height="58" rx="10" fill="none" stroke="currentColor" opacity=".4"/>
        <text x="105" y="192" text-anchor="middle" font-size="13">Services</text>

        <rect x="210" y="160" width="150" height="58" rx="10" fill="none" stroke="currentColor" opacity=".4"/>
        <text x="285" y="192" text-anchor="middle" font-size="13">People / Expertise</text>

        <rect x="400" y="160" width="150" height="58" rx="10" fill="none" stroke="currentColor" opacity=".4"/>
        <text x="475" y="192" text-anchor="middle" font-size="13">Locations</text>

        <rect x="580" y="160" width="150" height="58" rx="10" fill="none" stroke="currentColor" opacity=".4"/>
        <text x="655" y="192" text-anchor="middle" font-size="13">Supporting Content</text>

        <line x1="350" y1="76" x2="120" y2="154" stroke="currentColor" marker-end="url(#entityArrow)" opacity=".45"/>
        <line x1="370" y1="76" x2="292" y2="154" stroke="currentColor" marker-end="url(#entityArrow)" opacity=".45"/>
        <line x1="390" y1="76" x2="468" y2="154" stroke="currentColor" marker-end="url(#entityArrow)" opacity=".45"/>
        <line x1="410" y1="76" x2="640" y2="154" stroke="currentColor" marker-end="url(#entityArrow)" opacity=".45"/>
      </svg>
    </div>

        <h3>Material findings only</h3>
    <p class="small">Schema type counts do not become findings by themselves. A structured-data change should be prioritized only when it materially improves understanding of a real business, service, person, location, or supporting content relationship.</p>

    <h3>Unavailable or partial evidence</h3>
    ${assessed
      ? '<p class="small">Structured-data evidence was available for the observed types shown above. External knowledge-graph inclusion and actual AI/search retrieval were not assessed.</p>'
      : `<p class="small"><span class="chip cap-neutral">${e(UNAVAILABLE)}</span> Structured-data evidence was unavailable, so no absence was scored as a defect.</p>`}
  </section>`;
}
// ---------------------------------------------------------------------------
// Performance detail
// ---------------------------------------------------------------------------

function deviceCard(label, data) {
  if (
    !data ||
    data.status === "FAILED" ||
    data.status === "UNAVAILABLE"
  ) {
    return `
      <div class="pillar">
        <h4>${e(label)}</h4>
        <p class="small">Result: Unavailable${data?.status ? ` (${e(data.status)})` : ""}.
          No score or metric is inferred for this profile.</p>
      </div>`;
  }

  const s =
    data.scores ||
    {};

  const m =
    data.metrics ||
    {};

  const provenance =
    data.isFieldData === true
      ? "Field data (CrUX)"
      : data.isLabData === true
        ? "Lab data"
        : "Provenance not recorded";

  return `
    <div class="pillar">
      <h4>${e(label)}</h4>

      <p class="small">Tested URL: ${e(data.url || "Unavailable")}<br>
        Provider: ${e(data.source || "Unavailable")} · ${e(provenance)}${data.fallbackUsed ? " · fallback used" : ""}</p>

      <div class="table-wrap"><table>
        <thead><tr><th>Score</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Performance</td><td>${e(orUnavailable(s.performance))}</td></tr>
          <tr><td>Accessibility</td><td>${e(orUnavailable(s.accessibility))}</td></tr>
          <tr><td>Best Practices</td><td>${e(orUnavailable(s.bestPractices))}</td></tr>
          <tr><td>SEO</td><td>${e(orUnavailable(s.seo))}</td></tr>
        </tbody>
      </table></div>

      <div class="table-wrap"><table>
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>FCP</td><td>${e(orUnavailable(m.fcpMs, " ms"))}</td></tr>
          <tr><td>LCP</td><td>${e(orUnavailable(m.lcpMs, " ms"))}</td></tr>
          <tr><td>TBT</td><td>${e(orUnavailable(m.tbtMs, " ms"))}</td></tr>
          <tr><td>CLS</td><td>${e(orUnavailable(m.cls))}</td></tr>
        </tbody>
      </table></div>
    </div>`;
}

export function performanceDetailSection(model) {
  const perf =
    model?.evidence?.performance;

  if (!perf) {
    return `<section id="performance" class="card">
      <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Are your most important pages fast enough for visitors?</p>
      <p class="muted small">Performance · Performance Detail</p>
      <p><span class="chip cap-neutral">UNAVAILABLE</span> No performance evidence was collected. PRYSM cannot conclude that the site is fast or slow from missing evidence.</p>
    </section>`;
  }

  const field =
    perf.fieldData ||
    {};

  const fieldKeys =
    Object.keys(field);

  const pageResults =
    Array.isArray(perf.pageResults)
      ? perf.pageResults
      : [];

  const mobileScore =
    perf.mobile?.scores?.performance;

  const desktopScore =
    perf.desktop?.scores?.performance;

  const availableScores = [
    mobileScore,
    desktopScore,
  ].filter(
    (score) => typeof score === "number",
  );

  const weakest =
    availableScores.length
      ? Math.min(...availableScores)
      : null;

  const verdict =
    weakest === null
      ? "Performance evidence exists, but no usable mobile or desktop performance score was returned. PRYSM withholds a speed judgment."
      : weakest >= 90
        ? "The available performance evidence is strong across the tested profiles."
        : weakest >= 60
          ? "The tested experience is usable but leaves measurable performance headroom on at least one profile."
          : "At least one tested profile shows material performance friction that can affect important visitor and conversion paths.";

  const priorityRows = [
    ["Mobile", perf.mobile],
    ["Desktop", perf.desktop],
  ]
    .map(([label, data]) => {
      if (
        !data ||
        data.status === "FAILED" ||
        data.status === "UNAVAILABLE"
      ) {
        return `<tr>
          <td>${e(label)}</td>
          <td>Unavailable</td>
          <td>Unavailable</td>
          <td>Unavailable</td>
          <td><span class="chip cap-neutral">UNAVAILABLE</span></td>
        </tr>`;
      }

      const metrics =
        data.metrics ||
        {};

      const performanceScore =
        data.scores?.performance;

      const status =
        typeof performanceScore !== "number"
          ? "PARTIAL"
          : performanceScore >= 60
            ? "PASS"
            : "FINDING";

      return `<tr>
        <td>${e(label)}</td>
        <td>${e(orUnavailable(performanceScore))}</td>
        <td>${e(orUnavailable(metrics.lcpMs, " ms"))}</td>
        <td>${e(orUnavailable(metrics.cls))}</td>
        <td><span class="chip ${
          status === "PASS"
            ? "cap-ok"
            : status === "FINDING"
              ? "cap-missing"
              : "cap-neutral"
        }">${e(status)}</span></td>
      </tr>`;
    })
    .join("");

  const labBlock = `<div class="pillar-grid">
    ${deviceCard("Mobile", perf.mobile)}
    ${deviceCard("Desktop", perf.desktop)}
  </div>`;

  const fieldBlock = fieldKeys.length
    ? `<div class="table-wrap"><table>
        <thead>
          <tr>
            <th>Field profile</th>
            <th>Observed data</th>
          </tr>
        </thead>
        <tbody>${fieldKeys
          .map(
            (key) =>
              `<tr><td>${e(key)}</td><td class="small">${e(JSON.stringify(field[key]))}</td></tr>`,
          )
          .join("")}</tbody>
      </table></div>`
    : '<p><span class="chip cap-neutral">UNAVAILABLE</span> CrUX field data was not available. Lab results remain valid as lab evidence, but they are not treated as real-user field performance.</p>';

  const strengths = [];

  if (
    typeof mobileScore === "number" &&
    mobileScore >= 90
  ) {
    strengths.push(
      `Mobile lab performance scored ${mobileScore}/100.`,
    );
  }

  if (
    typeof desktopScore === "number" &&
    desktopScore >= 90
  ) {
    strengths.push(
      `Desktop lab performance scored ${desktopScore}/100.`,
    );
  }

  if (
    perf.mobile?.metrics?.cls !== undefined &&
    perf.mobile.metrics.cls !== null &&
    perf.mobile.metrics.cls <= 0.1
  ) {
    strengths.push(
      `Mobile CLS was ${perf.mobile.metrics.cls}, indicating stable layout in the tested run.`,
    );
  }

  if (
    perf.desktop?.metrics?.cls !== undefined &&
    perf.desktop.metrics.cls !== null &&
    perf.desktop.metrics.cls <= 0.1
  ) {
    strengths.push(
      `Desktop CLS was ${perf.desktop.metrics.cls}, indicating stable layout in the tested run.`,
    );
  }

  const findings = (model?.findings || []).filter(
    (finding) =>
      finding.dimension === "technical_performance" ||
      finding.module === "performance" ||
      /performance|LCP|CLS|TBT|render/i.test(
        finding.title ||
        "",
      ),
  );

  const collectedDiagnostics =
    Array.isArray(model.renderingDiagnostics);

  const diagnostics =
    collectedDiagnostics
      ? model.renderingDiagnostics
      : [];

  return `
  <section id="performance" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Are your most important pages fast enough for visitors?</p>
    <p class="muted small">Performance · Performance Detail</p>

    <h3>Direct answer</h3>
    <p>${e(verdict)}</p>

    <h3>Priority-page mobile / desktop performance</h3>
    <div class="table-wrap"><table>
      <thead>
        <tr>
          <th>Profile</th>
          <th>Performance</th>
          <th>LCP</th>
          <th>CLS</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${priorityRows}</tbody>
    </table></div>

    ${pageResults.length
      ? `<p class="muted small">${e(pageResults.length)} page-level performance result${pageResults.length === 1 ? " was" : "s were"} returned. The summary above presents the governed mobile/desktop profiles; raw page-result provenance remains secondary evidence.</p>`
      : ""}

    <h3>What does the visitor actually experience?</h3>
    <p class="small">LCP, CLS, TBT, response time, and related metrics support the conclusion; they are not the conclusion. PRYSM interprets performance by whether delivery friction is likely to affect important user and conversion paths.</p>

    <h3>Lab performance</h3>
    ${labBlock}

    <h3>Field performance</h3>
    ${fieldBlock}

    <h3>What is already performing well</h3>
    ${strengths.length
      ? `<ul>${strengths.map((item) => `<li>${e(item)}</li>`).join("")}</ul>`
      : "<p>No performance strength met the threshold for a clear positive statement from the available evidence.</p>"}

    <h3>Material performance findings</h3>
    ${findings.length
      ? `<ul>${findings
          .slice(0, 6)
          .map(
            (finding) =>
              `<li><strong>${e(finding.title || "Performance finding")}</strong> — ${e(finding.businessImpact || "")}${finding.recommendation ? ` <strong>Action:</strong> ${e(finding.recommendation)}` : ""}</li>`,
          )
          .join("")}</ul>`
      : "<p>No material governed performance finding was produced from the assessed evidence.</p>"}

    <h3>Rendering integrity</h3>
    ${!collectedDiagnostics
      ? `<p><span class="chip cap-neutral">${e(UNAVAILABLE)}</span> Rendering-integrity diagnostics were not carried into this report model.</p>`
      : diagnostics.length
        ? `<ul>${diagnostics
            .slice(0, 10)
            .map(
              (diagnostic) =>
                `<li><strong>${e(diagnostic.diagnosticCode || "Diagnostic")}:</strong> ${e(diagnostic.clientExplanation || "")}${diagnostic.affectedUrl ? ` — ${e(diagnostic.affectedUrl)}` : ""}</li>`,
            )
            .join("")}</ul>`
        : "<p>Rendering integrity was assessed and no diagnostic was raised.</p>"}

    <h3>Partial or unavailable evidence</h3>
    ${(perf.limitations || []).length
      ? `<ul>${perf.limitations.map((limitation) => `<li>${e(limitation)}</li>`).join("")}</ul>`
      : fieldKeys.length
        ? "<p>No additional provider limitation was recorded.</p>"
        : "<p>Field performance was unavailable. This limits conclusions about real-user experience but does not invalidate the available lab measurements.</p>"}
  </section>`;
}

// ---------------------------------------------------------------------------
// Accessibility & mobile usability readiness
// ---------------------------------------------------------------------------

export function accessibilityMobileSection(model) {
  const site =
    model?.evidence?.site ||
    {};

  const perf =
    model?.evidence?.performance ||
    {};

  const contentOk =
    capAvailable(
      model,
      "content.body",
    );

  const mobileAccessibility =
    perf.mobile?.scores?.accessibility;

  const desktopAccessibility =
    perf.desktop?.scores?.accessibility;

  const accessibilityScores = [
    mobileAccessibility,
    desktopAccessibility,
  ].filter(
    (score) => typeof score === "number",
  );

  const accessibilityScore =
    accessibilityScores.length
      ? Math.min(...accessibilityScores)
      : null;

  const areas = [
    {
      area: "Mobile viewport",
      status: "UNAVAILABLE",
      detail:
        "A dedicated viewport configuration result is not carried in the current report model.",
      impact:
        "PRYSM withholds a viewport conclusion rather than treating missing evidence as a failure.",
    },
    {
      area: "Responsive layout",
      status: "UNAVAILABLE",
      detail:
        "A dedicated responsive-layout result is not carried in the current report model.",
      impact:
        "Layout behavior across breakpoints cannot be determined from the available report evidence.",
    },
    {
      area: "Font legibility",
      status: "UNAVAILABLE",
      detail:
        "A dedicated font-legibility audit result is not carried in the current report model.",
      impact:
        "PRYSM does not infer readability from unrelated performance metrics.",
    },
    {
      area: "Tap-target sizing",
      status: "UNAVAILABLE",
      detail:
        "A dedicated tap-target result is not carried in the current report model.",
      impact:
        "Touch-target usability cannot be concluded from missing evidence.",
    },
    {
      area: "Accessibility readiness",
      status:
        accessibilityScore === null
          ? "UNAVAILABLE"
          : accessibilityScore >= 90
            ? "PASS"
            : "PARTIAL",
      detail:
        accessibilityScore === null
          ? "No Lighthouse accessibility score was available for the tested mobile or desktop profile."
          : `Lowest available Lighthouse accessibility score: ${accessibilityScore}/100${typeof mobileAccessibility === "number" ? `; mobile ${mobileAccessibility}/100` : ""}${typeof desktopAccessibility === "number" ? `; desktop ${desktopAccessibility}/100` : ""}.`,
      impact:
        accessibilityScore === null
          ? "Automated accessibility readiness could not be summarized."
          : accessibilityScore >= 90
            ? "The automated result is a positive readiness signal but does not establish legal or standards compliance."
            : "The automated score indicates potential accessibility risk that requires issue-level evidence before PRYSM treats it as a material barrier; it does not establish legal or standards compliance.",
    },
    {
      area: "Image alternative text",
      status:
        contentOk &&
        typeof site.imageCount === "number"
          ? (site.imagesMissingAlt || 0) > 0
            ? "FINDING"
            : "PASS"
          : "UNAVAILABLE",
      detail:
        contentOk &&
        typeof site.imageCount === "number"
          ? `${site.imagesMissingAlt ?? 0} of ${site.imageCount} observed image(s) were missing alternative text.`
          : "Image/alt-text evidence was not available.",
      impact:
        "Alternative text supports non-visual understanding of meaningful images when correctly written.",
    },
  ];

  const barriers = areas.filter(
    (item) =>
      item.status === "FINDING",
  );

  const available = areas.filter(
    (item) =>
      item.status === "PASS" ||
      item.status === "FINDING",
  );

  const unavailable = areas.filter(
    (item) =>
      item.status === "UNAVAILABLE" ||
      item.status === "PARTIAL",
  );

  const summary = barriers.length
    ? `${barriers.length} observable accessibility or usability barrier${barriers.length === 1 ? " was" : "s were"} identified in the evidence available to this report. Several deeper mobile-usability checks remain unavailable.`
    : available.length
      ? "No material barrier was established from the accessibility evidence that was available, but several deeper mobile-usability checks remain unavailable or partial."
      : "PRYSM does not have enough accessibility or mobile-usability evidence in the current report model to make a readiness judgment.";

  return `
  <section id="accessibility-mobile" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Can visitors comfortably understand, navigate, and act on your site?</p>
    <p class="muted small">Accessibility &amp; Mobile Usability Readiness</p>

    <h3>Readiness summary</h3>
    <p>${e(summary)}</p>

    <h3>Material barriers</h3>
    ${barriers.length
      ? `<ul>${barriers
          .map(
            (item) =>
              `<li><strong>${e(item.area)}:</strong> ${e(item.detail)} ${e(item.impact)}</li>`,
          )
          .join("")}</ul>`
      : "<p>No material barrier was established from the evidence currently available.</p>"}

    <h3>Coverage notes</h3>
    <div class="table-wrap"><table>
      <thead>
        <tr>
          <th>Area</th>
          <th>Status</th>
          <th>What was available</th>
          <th>What it means</th>
        </tr>
      </thead>
      <tbody>${areas
        .map(
          (item) => `<tr>
            <td><strong>${e(item.area)}</strong></td>
            <td><span class="chip ${
              item.status === "PASS"
                ? "cap-ok"
                : item.status === "FINDING"
                  ? "cap-missing"
                  : "cap-neutral"
            }">${e(item.status)}</span></td>
            <td class="small">${e(item.detail)}</td>
            <td class="small">${e(item.impact)}</td>
          </tr>`,
        )
        .join("")}</tbody>
    </table></div>

    ${unavailable.length
      ? `<div class="note"><strong>PARTIAL / UNAVAILABLE:</strong> ${e(unavailable.map((item) => item.area).join(", "))} could not be fully assessed from the current report model. These gaps reduce accessibility/mobile coverage but are not treated as negative site findings.</div>`
      : ""}

    <div class="note"><strong>Accessibility disclaimer:</strong> Accessibility Readiness identifies observable barriers and risks. It does not certify legal compliance with AODA, WCAG, or other accessibility standards.</div>
  </section>`;
}
// ---------------------------------------------------------------------------
// Machine readiness — structural readability only, never AI visibility
// ---------------------------------------------------------------------------

export function machineReadinessSection(model) {
  const score =
    model?.scores?.aiReadiness;

  const value =
    typeof score === "number" &&
    Number.isFinite(score)
      ? `${score}/100`
      : UNAVAILABLE;

  return `
  <section id="machine-readiness" class="card">
    <h2>Machine Readability</h2>
    <p class="muted small">This measures how readable the site's structure is to automated systems —
      structured data, heading hierarchy, and content depth. It is a structural machine-readability signal
      and is <strong>not</strong> a measurement of whether the site actually appears in, or is retrieved by,
      any AI assistant or AI search product.</p>
    <p><strong>Structural machine-readability score:</strong> ${e(value)}</p>
  </section>`;
}

// ---------------------------------------------------------------------------
// What is already good
// ---------------------------------------------------------------------------

export function strengthsSection(model, checklist) {
  const site =
    model?.evidence?.site ||
    {};

  const strengths = [];

  for (const item of checklist || []) {
    if (
      item.status ===
      FOUNDATION_STATUS.PASS
    ) {
      strengths.push([
        item.label,
        item.detail,
      ]);
    }
  }

  if (
    capAvailable(
      model,
      "schema.structured_data",
    ) &&
    (site.schemaTypes || []).length
  ) {
    strengths.push([
      "Structured data present",
      `Detected type(s): ${(site.schemaTypes || []).join(", ")}.`,
    ]);
  }

  if (
    capAvailable(
      model,
      "trust.proof",
    )
  ) {
    const found = Object.entries(
      site.trust ||
      {},
    )
      .filter(
        ([, present]) =>
          present === true,
      )
      .map(
        ([name]) =>
          name,
      );

    if (found.length) {
      strengths.push([
        "Trust signals detected",
        `Detected on crawled pages: ${found.join(", ")}.`,
      ]);
    }
  }

  const desktop =
    model?.evidence?.performance?.desktop?.scores?.performance;

  if (
    typeof desktop === "number" &&
    desktop >= 90
  ) {
    strengths.push([
      "Desktop performance",
      `Desktop performance scored ${desktop}/100 in lab testing.`,
    ]);
  }

  const brokenLinks =
    (site.brokenInternalLinks || []).length;

  if (
    (site.internalLinkCount ?? 0) > 0 &&
    brokenLinks === 0
  ) {
    strengths.push([
      "Internal links resolve",
      `${site.internalLinkCount} internal link(s) detected with none broken.`,
    ]);
  }

  const body = strengths.length
    ? `<ul class="small">${strengths
        .map(
          ([label, detail]) =>
            `<li><strong>${e(label)}</strong> — ${e(detail)}</li>`,
        )
        .join("")}</ul>`
    : `<p class="small">No strength could be confirmed from the evidence that was collected. This is a limit of the
        assessed evidence, not a judgement that the site has no strengths.</p>`;

  return `
  <section id="strengths" class="card">
    <h2>What Is Already Good</h2>
    <p class="muted small">Only items whose supporting capability was actually assessed appear here.</p>
    ${body}
  </section>`;
}

// ---------------------------------------------------------------------------
// Client action plan
// ---------------------------------------------------------------------------

const GROUP_INTRO = {
  [ACTION_GROUP.DO_NOW]:
    "Verified foundations and the highest-confidence conversion work.",
  [ACTION_GROUP.DO_NEXT]:
    "Material conversion improvements once the items above are in progress.",
  [ACTION_GROUP.LATER]:
    "Refinement and optimization after the core issues are resolved.",
};

function actionRows(actions) {
  if (!actions.length) {
    return '<p class="small">Nothing in this group from the assessed evidence.</p>';
  }

  return `<div class="table-wrap"><table>
    <thead>
      <tr>
        <th>#</th>
        <th>What we change</th>
        <th>Why</th>
        <th>Class</th>
        <th>Effort</th>
        <th>How we verify it</th>
      </tr>
    </thead>

    <tbody>${actions
      .map(
        (a) => `<tr>
          <td>${e(a.rank)}</td>
          <td><strong>${e(a.finding.title)}</strong><br><span class="small">${e(a.finding.recommendation || "")}</span></td>
          <td class="small">${e(a.finding.businessImpact || "")}</td>
          <td class="small">${e(a.actionClass)}</td>
          <td class="small">${e(a.effort)}</td>
          <td class="small">${e(a.verificationMethod)}</td>
        </tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

export function actionPlanSection(plan, checklist) {
  const groupBlocks = [
    ACTION_GROUP.DO_NOW,
    ACTION_GROUP.DO_NEXT,
    ACTION_GROUP.LATER,
  ]
    .map(
      (group) => `<h3>${e(group)}</h3>
        <p class="muted small">${e(GROUP_INTRO[group])}</p>
        ${actionRows(plan.groups[group] || [])}`,
    )
    .join("");

  const measures = [
    ...new Set(
      plan.actions
        .map(
          (a) =>
            a.verificationMethod,
        )
        .filter(Boolean),
    ),
  ];

  const foundationsToFix = (
    checklist ||
    []
  )
    .filter(
      (i) =>
        i.status ===
          FOUNDATION_STATUS.ACTION_REQUIRED &&
        i.foundational === true,
    )
    .map(
      (i) =>
        i.label,
    );

  return `
  <section id="action-plan" class="card">
    <h2>Client Action Plan</h2>

    <p class="muted small">Derived from the same governed priorities as Section E. Sequence only — no business
      outcome, revenue figure, or performance projection is stated.</p>

    ${foundationsToFix.length
      ? `<p class="small"><strong>Foundations to resolve alongside these actions:</strong> ${e(foundationsToFix.join(", "))}.</p>`
      : ""}

    ${groupBlocks}

    <h3>MEASURE</h3>

    <p class="muted small">Evidence to compare in the next audit:</p>

    ${measures.length
      ? `<ul class="small">${measures.map((m) => `<li>${e(m)}</li>`).join("")}</ul>`
      : '<p class="small">No verification step is available because no score-bearing action was produced.</p>'}
  </section>`;
}

// ---------------------------------------------------------------------------
// Phase 2 scope — explicitly outside this audit
// ---------------------------------------------------------------------------

const PHASE_2_ITEMS = [
  [
    "Backlinks and referring domains",
    "Off-site authority evidence",
  ],
  [
    "Third-party reviews",
    "Review-platform evidence",
  ],
  [
    "External entity mentions",
    "Entity corroboration across external sources",
  ],
  [
    "Long-term authority growth",
    "Trend evidence across repeated audits",
  ],
];

export function phase2Section() {
  return `
  <section id="phase2" class="card">
    <h2>Beyond This Audit — Outside Phase 1 Scope</h2>

    <p class="muted small">These areas were outside the scope of this audit. They are listed so the scope is explicit;
      nothing below is a finding, and none of them affects the Conversion Readiness score.</p>

    <div class="table-wrap"><table>
      <thead>
        <tr>
          <th>Area</th>
          <th>Evidence that would be required</th>
          <th>Status</th>
        </tr>
      </thead>

      <tbody>${PHASE_2_ITEMS
        .map(
          ([area, req]) =>
            `<tr>
              <td>${e(area)}</td>
              <td class="small">${e(req)}</td>
              <td><span class="chip cap-neutral">NOT APPLICABLE</span></td>
            </tr>`,
        )
        .join("")}</tbody>
    </table></div>
  </section>`;
}

export default {
  foundationSection,
  eeatSection,
  technicalDetailSection,
  headingSection,
  schemaSection,
  performanceDetailSection,
  accessibilityMobileSection,
  machineReadinessSection,
  strengthsSection,
  actionPlanSection,
  phase2Section,
};