import { domainOf } from "../utils.js";

function domainLabel(domain) {
  const label = String(domain || "").replace(/^www\./i, "").split(".")[0] || "";
  return label.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).trim();
}

function comparable(value) {
  return String(value || "").toLowerCase().replace(/\.[a-z]{2,}$/i, "").replace(/[^a-z0-9]+/g, "");
}

function isUsableName(value, domain) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 160 || /^(home|welcome|about|contact|services|website|untitled)$/i.test(name)) return false;
  // A concatenated domain label such as `rebootbusinesscoaching` is a
  // mechanical identifier, while the persisted human-readable
  // `Reboot Business Coaching` is valid even though both normalize to the
  // same comparable form.
  if (!/\s/.test(name) && comparable(name) === comparable(domain)) return false;
  return /[a-z]/i.test(name);
}

export function resolveBusinessDisplayName(auditRequest = {}, site = {}) {
  const domain = site.domain || (() => { try { return domainOf(auditRequest.targetUrl); } catch { return ""; } })();
  const candidates = Array.isArray(site.identityCandidates) ? site.identityCandidates : [];
  const structured = candidates
    .filter((item) => item && ["organization-schema", "local-business-schema", "site-name-meta", "site-identity"].includes(item.source))
    .map((item) => item.value).filter((value) => isUsableName(value, domain));
  if (structured.length) return structured[0];
  const explicit = String(auditRequest.businessName || "").trim();
  if (isUsableName(explicit, domain)) return explicit;
  for (const page of site.pages || []) {
    const title = String(page?.title || "").split(/\s+[|—–:-]\s+/)[0].trim();
    if (isUsableName(title, domain)) return title;
  }
  return domainLabel(domain) || "Website Audit";
}

export { domainLabel, isUsableName };
