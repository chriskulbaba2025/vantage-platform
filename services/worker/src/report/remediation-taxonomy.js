const REMEDIATION_TAXONOMY = Object.freeze({
  I01: Object.freeze([
    Object.freeze({ title: "Optimize the main above-the-fold asset", detail: "Compress, resize, or replace an oversized image, video, or hero asset." }),
    Object.freeze({ title: "Reduce work that blocks the first render", detail: "Defer or reduce unnecessary CSS, JavaScript, web fonts, or other resources that must load before primary content appears." }),
    Object.freeze({ title: "Reduce delivery delays", detail: "Review slow server responses and third-party work that may delay initial rendering." }),
  ]),
  J04: Object.freeze([
    Object.freeze({ title: "Add supported structured data", detail: "Use Organization, Service, LocalBusiness, Article, Breadcrumb, or other schema only where the page and business evidence supports it." }),
    Object.freeze({ title: "Configure the site's schema output", detail: "Review the CMS, SEO or schema plugin, and page-template settings that control structured-data generation." }),
    Object.freeze({ title: "Validate the rendered markup", detail: "Check the final HTML and correct structured data that is invalid, incomplete, or conflicting." }),
  ]),
  A03: Object.freeze([
    Object.freeze({ title: "Write useful page-specific descriptions", detail: "Add a concise description that accurately reflects the important content of each assessed page." }),
    Object.freeze({ title: "Configure sensible CMS or template defaults", detail: "Provide a suitable default for pages that do not have a manually written description." }),
    Object.freeze({ title: "Correct metadata output rules", detail: "Review SEO-plugin, template, or rendering rules that may suppress, override, or fail to output the intended description." }),
  ]),
  D01: Object.freeze([
    Object.freeze({ title: "Answer the recorded buyer question directly", detail: "Add a clear answer to the specific question identified in the reviewed evidence." }),
    Object.freeze({ title: "Add the detail that makes the answer useful", detail: "Explain the relevant service, process, or requirement using information confirmed by the business." }),
    Object.freeze({ title: "Place the answer in decision context", detail: "Position it beside the related choice or next step so it is easy to find when needed." }),
  ]),
  F02: Object.freeze([
    Object.freeze({ title: "Place the primary action near the decision", detail: "Make the intended action available close to the content where the next step is explained." }),
    Object.freeze({ title: "Improve the action's visibility or reach", detail: "Review its label, visual distinction, size, or tap target while preserving the intended action." }),
    Object.freeze({ title: "Reduce competition around the action", detail: "Simplify nearby controls or adjust mobile placement so the primary action remains easy to find." }),
  ]),
  E01: Object.freeze([
    Object.freeze({ title: "Add relevant, verifiable proof", detail: "Use an accurate testimonial, review, credential, or project example only when it is available and authorized for use." }),
    Object.freeze({ title: "Make the source and scope clear", detail: "Explain who or what the existing proof represents and how it relates to the claim." }),
    Object.freeze({ title: "Place proof beside the related decision", detail: "Show suitable evidence near the service claim or action it is meant to support." }),
  ]),
  D03: Object.freeze([
    Object.freeze({ title: "Explain the pricing model", detail: "Clarify what is included and how the service is priced, using terms the business can support." }),
    Object.freeze({ title: "Describe supported price ranges or variables", detail: "Where substantiated, show a range or explain the factors that affect a quote." }),
    Object.freeze({ title: "Clarify what happens before commitment", detail: "Explain what information is needed and what the client can expect before pricing is confirmed." }),
  ]),
  D06: Object.freeze([
    Object.freeze({ title: "Replace generic copy with specific details", detail: "Add accurate service, process, scope, or eligibility information relevant to the page's purpose." }),
    Object.freeze({ title: "Use a grounded example", detail: "Add a concrete example or use case based on the business's actual work." }),
    Object.freeze({ title: "Give each section a distinct job", detail: "Remove repeated filler and make each section answer a clear need for that page." }),
  ]),
  J03: Object.freeze([
    Object.freeze({ title: "Organize headings into a clear hierarchy", detail: "Arrange the page's headings in an order that follows its sections." }),
    Object.freeze({ title: "Make headings describe their content", detail: "Use labels that accurately introduce the section beneath each heading." }),
    Object.freeze({ title: "Use semantic sections where helpful", detail: "Review document landmarks and section structure to support navigation and interpretation." }),
  ]),
  H04: Object.freeze([
    Object.freeze({ title: "Add text alternatives to informative images", detail: "Describe the information conveyed by meaningful images; leave decorative images without redundant descriptions." }),
    Object.freeze({ title: "Provide captions or transcripts for media", detail: "Give meaningful audio or video an equivalent text form when the reviewed content calls for it." }),
    Object.freeze({ title: "Describe complex visuals in an equivalent format", detail: "Provide a nearby text or data description for charts, diagrams, or other visuals whose meaning is not conveyed by a short label." }),
  ]),
  H06: Object.freeze([
    Object.freeze({ title: "Set dimensions for media", detail: "Use intrinsic dimensions or aspect ratios for images, video, and embedded content." }),
    Object.freeze({ title: "Reserve space for inserted content", detail: "Plan for content such as consent notices or promotions that may appear after the initial layout." }),
    Object.freeze({ title: "Review font loading and fallback metrics", detail: "Check whether font loading or fallback differences can be adjusted to reduce text reflow." }),
  ]),
});

export const COMMON_REMEDIATION_DISCLAIMER =
  "These are common options for this type of issue. PRYSM confirmed the finding, but has not established which fix is right until the affected implementation is checked.";

export const REMEDIATION_NOT_YET_SUPPORTED =
  "Common remediation options are not yet available for this finding. Review the supporting evidence before deciding how to correct it.";

export const REMEDIATION_SUPPORT = Object.freeze({
  supported: Object.freeze(Object.keys(REMEDIATION_TAXONOMY)),
  unsupported: Object.freeze({
    A01: "Search-intent remediation depends on validated query/intent evidence; generic keyword or ranking advice could invent demand or prescribe unsupported SEO work.",
    E07: "Privacy, security, and consent remediation may involve security, legal, privacy, or jurisdiction-specific obligations; no generic fix is approved without a validated subtype.",
  }),
});

function familyIds(unit) {
  if (Array.isArray(unit?.canonicalProblemIds)) {
    return [...new Set(unit.canonicalProblemIds.filter((id) => typeof id === "string" && id))];
  }
  return typeof unit?.canonicalProblemId === "string" && unit.canonicalProblemId
    ? [unit.canonicalProblemId]
    : [];
}

/**
 * Bind approved remediation options to an already accepted Encyclopedia unit.
 * This projection does not decide whether the unit is a priority and never
 * reads finding prose, URLs, severity, score, or implementation recommendations.
 */
export function projectPriorityRemediation(groupOrUnit) {
  const unit = groupOrUnit?.unit || groupOrUnit;
  const ids = familyIds(unit);
  if (ids.length !== 1) {
    return Object.freeze({
      status: "REMEDIATION_NOT_YET_SUPPORTED",
      familyIds: Object.freeze(ids),
      message: REMEDIATION_NOT_YET_SUPPORTED,
      options: Object.freeze([]),
    });
  }

  const options = REMEDIATION_TAXONOMY[ids[0]];
  if (!options) {
    return Object.freeze({
      status: "REMEDIATION_NOT_YET_SUPPORTED",
      familyIds: Object.freeze(ids),
      message: REMEDIATION_NOT_YET_SUPPORTED,
      options: Object.freeze([]),
    });
  }

  return Object.freeze({
    status: "SUPPORTED",
    familyIds: Object.freeze(ids),
    disclaimer: COMMON_REMEDIATION_DISCLAIMER,
    options,
  });
}

export { REMEDIATION_TAXONOMY };
