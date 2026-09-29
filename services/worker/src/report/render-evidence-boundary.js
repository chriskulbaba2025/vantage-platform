import { e, section } from "./html-helpers.js";

const VIABLE = new Set(["AVAILABLE", "PARTIAL"]);

const PAGE_REQUIREMENTS = Object.freeze({
  "content-ideas": ["content.body", "offer.clarity"],
  "trust-eeat": ["trust.proof"],
  performance: ["performance.lab"],
});

const SITE_PAGES = new Set([
  "content-ideas", "trust-eeat", "cms-constraints", "technical-seo",
  "headings", "schema", "evidence-appendix",
]);

function capability(model, name) {
  return model?.capabilityEvidence?.capabilities?.[name] || null;
}

function siteStatus(model) {
  return model?.evidence?.site?.sourceStatus || model?.sourceStatus?.website || "UNKNOWN";
}

function pageStatus(model, pageId) {
  if (pageId === "performance") {
    return model?.evidence?.performance?.sourceStatus || model?.sourceStatus?.performance || "UNKNOWN";
  }
  return siteStatus(model);
}

function reason(model, pageId) {
  const requirement = (PAGE_REQUIREMENTS[pageId] || [])
    .map((name) => ({ name, value: capability(model, name) }))
    .find(({ value }) => value && value.requiredFieldsPresent === false);
  if (requirement) {
    return `Required capability ${requirement.name} is ${requirement.value.status || "UNAVAILABLE"}; missing fields are not converted into site claims.`;
  }
  return `Required ${pageId === "performance" ? "performance" : "website"} evidence is ${pageStatus(model, pageId)}; this module remains not assessed.`;
}

export function shouldRenderUnavailablePage(model, pageId) {
  if (SITE_PAGES.has(pageId) && !VIABLE.has(siteStatus(model))) return true;
  if (pageId === "performance" && !VIABLE.has(pageStatus(model, pageId))) return true;
  return (PAGE_REQUIREMENTS[pageId] || []).some((name) => {
    const value = capability(model, name);
    return value && value.requiredFieldsPresent === false;
  });
}

export function renderUnavailablePage(model, pageDef) {
  const evidence = pageDef.pageId === "performance"
    ? model?.evidence?.performance
    : model?.evidence?.site;
  const limitations = Array.isArray(evidence?.limitations)
    ? evidence.limitations.slice(0, 5)
    : [];
  const limitationHtml = limitations.length
    ? `<ul>${limitations.map((item) => `<li>${e(item)}</li>`).join("")}</ul>`
    : "<p>No additional limitation was supplied.</p>";
  return section(
    pageDef.sectionId,
    pageDef.secNum,
    pageDef.title,
    `<div class="note"><p><strong>Status: ${e(pageStatus(model, pageDef.pageId))}</strong></p><p>${e(reason(model, pageDef.pageId))}</p><p>No positive or negative website conclusion is made from absent evidence.</p></div><h3>Stored limitations</h3>${limitationHtml}`,
  );
}

