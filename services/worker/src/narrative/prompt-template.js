/**
 * WP9 — Narrative Prompt Template
 *
 * Short, fixed, versioned prompt instructions. Requests only fields
 * allowed by the frozen NarrativeResponse contract.
 *
 * Does NOT include: conversation history, raw evidence, raw provider data,
 * code, HTML, CSS, or debug data.
 *
 * @module narrative/prompt-template
 */

export const NARRATIVE_PROMPT_VERSION = "1.0.0";

/**
 * Build the governed narrative prompt from a ReportContentPackage.
 *
 * @param {object} reportPackage — WP8 ReportContentPackage
 * @returns {string} Prompt text
 */
export function buildPrompt(reportPackage) {
  const businessName = reportPackage.business?.name || "the website";
  const findingCount = (reportPackage.findings || []).length;
  const topFindings = (reportPackage.findings || [])
    .slice(0, 5)
    .map((f, i) => `${i + 1}. [${f.findingId}] ${f.title} (${f.severity})`);

  return [
    `You are generating a structured narrative for a website conversion audit.`,
    ``,
    `Business: ${businessName}`,
    `Domain: ${reportPackage.business?.domain || "unknown"}`,
    `Readiness: ${reportPackage.readinessStatus || "Unknown"}`,
    `Assessed weight: ${reportPackage.assessedWeight ?? "N/A"}%`,
    `Evidence confidence: ${reportPackage.evidenceConfidenceScore ?? "N/A"}/100`,
    ``,
    `Top findings (${findingCount} total):`,
    ...topFindings,
    ``,
    `Produce a JSON response with these fields:`,
    `- executiveSummary: 2-3 sentence summary of the audit's most important finding`,
    `- priorityFixNarrative: 1-2 sentence explanation of the highest-priority fix`,
    `- referencedFindingIds: array of finding IDs referenced in your narrative`,
    ``,
    `RULES:`,
    `- Use only finding IDs listed above`,
    `- Do not invent findings, scores, URLs, or recommendations`,
    `- Do not include HTML, CSS, or markdown`,
    `- Keep executiveSummary under 150 words`,
    `- Keep priorityFixNarrative under 100 words`,
    `- Return valid JSON matching the output schema`,
  ].join("\n");
}
