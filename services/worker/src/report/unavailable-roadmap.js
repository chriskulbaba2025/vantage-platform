/** Deterministic, client-safe next-step metadata for unavailable/partial evidence. */
const ROADMAP = Object.freeze({
  accessibility: { requiredInformation: "A rendered mobile and responsive interaction assessment across representative pages.", enablement: "Enable a browser-based mobile/responsive assessment for the priority pages and repeat it at the key viewport sizes.", additionalInsight: "PRYSM could report observed viewport, layout, legibility, and tap-target results for the assessed pages." },
  partialCrawl: { requiredInformation: "A complete crawl response for the pages that were not returned in the current assessment.", enablement: "Allow the crawler to reach the remaining pages and retain their returned bodies and status codes.", additionalInsight: "PRYSM could distinguish site-wide patterns from observations limited to the collected pages." },
  fieldPerformance: { requiredInformation: "Real-user field performance data, such as CrUX data for the site or origin.", enablement: "Connect or enable an eligible field-data source and collect a representative measurement window.", additionalInsight: "PRYSM could report real-user experience alongside, and separately from, lab measurements." },
  ga4: { requiredInformation: "An authorized GA4 property with usable engagement and conversion data.", enablement: "Connect the relevant GA4 property and authorize the required read-only data scope.", additionalInsight: "PRYSM could analyze observed engagement and conversion paths over the collected period." },
  backlinks: { requiredInformation: "An authorized backlink source with the site's referring-domain and link data.", enablement: "Connect an eligible backlink data source and provide the required read-only access.", additionalInsight: "PRYSM could assess external authority signals and evidence-backed link opportunities." },
  structuredData: { requiredInformation: "A fresh rendered-page structured-data capture for the pages being validated.", enablement: "Re-crawl the implemented pages after structured data is added or changed and retain the returned markup.", additionalInsight: "PRYSM could verify the observed structured-data types and whether rich-result eligibility can be assessed." },
});

export function unavailableRoadmap(key) {
  const item = ROADMAP[key];
  return item ? { ...item } : null;
}

export function withUnavailableRoadmap(item, key) {
  const roadmap = unavailableRoadmap(key);
  return roadmap ? { ...item, roadmap } : item;
}
