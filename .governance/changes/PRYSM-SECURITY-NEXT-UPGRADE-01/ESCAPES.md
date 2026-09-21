# Verification Escape Ledger

The authoritative hosted Preview build exposed critical/high dependency advisories after the report and worker closure proof had passed. This means the previous verification pack did not gate the frontend dependency audit. Classify the escape as **GOVERNANCE_DEFECT** (security dependency audit omitted from the hosted terminal gate), in addition to the vulnerable dependency graph.

Permanent prevention: the PRYSM security change gate now requires both `npm audit --audit-level=high` and `npm audit --omit=dev --audit-level=high`, and the patched versions must be recorded on the exact candidate before staging confirmation. Do not classify the escaped advisories as random noise.
