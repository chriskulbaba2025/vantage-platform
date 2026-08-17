/**
 * Deterministic audit-timestamp formatting for the Prysm web app.
 *
 * Stored timestamps remain UTC/ISO (never mutated).  Display-only
 * conversion to the business/user Eastern timezone using the IANA zone
 * America/Toronto so DST (EDT/EST) is handled automatically — never a
 * hardcoded offset.
 *
 * PRYSM-INCIDENT-01 timezone correction.
 */

const TIME_ZONE = "America/Toronto";

const TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Format an ISO timestamp as a full Eastern date+time string (e.g. 2026-08-16, 10:43 p.m.). */
export function formatAuditTimestamp(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return TIME_FORMATTER.format(date);
}

/** Format an ISO timestamp as an Eastern date only (e.g. 2026-08-16). */
export function formatAuditDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_FORMATTER.format(date);
}

/** Format an ISO timestamp as Eastern time of day only (e.g. 10:43 p.m.). */
export function formatAuditTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export { TIME_ZONE };
