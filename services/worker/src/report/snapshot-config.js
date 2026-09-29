export const SNAPSHOT_V1_CTA_URL = "https://calendly.com/brad-omnipresence/30min";

export function resolveSnapshotV1CtaUrl(auditRequest = {}, env = process.env) {
  const configured = auditRequest.report?.snapshotCtaUrl || env.PRYSM_OMNIPRESENCE_BOOKING_URL || SNAPSHOT_V1_CTA_URL;
  try {
    const parsed = new URL(configured);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}
