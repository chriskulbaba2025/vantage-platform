/**
 * WP11 Audit Request Form Validation
 *
 * Validates web form input before creating an AuditRequest.
 * Runs in the browser (client-side validation) and server (re-validation).
 */

export interface AuditFormInput {
  targetUrl: string;
  businessName: string;
  market?: string;
  language?: string;
  primaryGoal?: string;
  services?: string[];
  competitors?: string[];
  ga4PropertyId?: string;
  gscSiteUrl?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

const URL_RE = /^https?:\/\/.+/i;

export function validateAuditForm(input: Partial<AuditFormInput>): ValidationResult {
  const errors: Record<string, string> = {};

  // Required: target URL
  if (!input.targetUrl || !input.targetUrl.trim()) {
    errors.targetUrl = "Target URL is required.";
  } else if (!URL_RE.test(input.targetUrl.trim()) && !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(input.targetUrl.trim())) {
    errors.targetUrl = "Enter a valid URL (e.g., https://example.com).";
  }

  // Required: business name
  if (!input.businessName || !input.businessName.trim()) {
    errors.businessName = "Business name is required.";
  }

  // Competitors: max 3, valid URLs
  const competitors = input.competitors || [];
  if (competitors.length > 3) {
    errors.competitors = "Maximum 3 competitor URLs allowed.";
  }
  for (let i = 0; i < competitors.length; i++) {
    const c = competitors[i].trim();
    if (c && !URL_RE.test(c) && !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(c)) {
      errors[`competitor_${i}`] = `Invalid URL: "${c}".`;
    }
  }

  // GA4: digits only
  if (input.ga4PropertyId && !/^\d+$/.test(input.ga4PropertyId)) {
    errors.ga4PropertyId = "GA4 Property ID must contain only digits.";
  }

  // GSC: valid site URL form
  if (input.gscSiteUrl) {
    const gsc = input.gscSiteUrl.trim();
    const isScDomain = gsc.startsWith("sc-domain:");
    const isUrlPrefix = URL_RE.test(gsc) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(gsc);
    if (!isScDomain && !isUrlPrefix) {
      errors.gscSiteUrl = "GSC site URL must be a valid URL or sc-domain: prefix.";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/** Build a clean submission payload from validated form input */
export function buildAuditPayload(input: AuditFormInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    targetUrl: input.targetUrl.trim(),
    businessName: input.businessName.trim(),
  };

  if (input.market?.trim()) payload.market = input.market.trim();
  if (input.language?.trim()) payload.language = input.language.trim();
  if (input.primaryGoal?.trim()) payload.primaryGoal = input.primaryGoal.trim();
  if (input.services?.length) payload.services = input.services.filter((s) => s.trim());
  if (input.competitors?.length) payload.competitors = input.competitors.filter((c) => c.trim());

  if (input.ga4PropertyId?.trim()) {
    payload.ga4 = { propertyId: input.ga4PropertyId.trim() };
  }
  if (input.gscSiteUrl?.trim()) {
    payload.gsc = { siteUrl: input.gscSiteUrl.trim() };
  }

  return payload;
}
