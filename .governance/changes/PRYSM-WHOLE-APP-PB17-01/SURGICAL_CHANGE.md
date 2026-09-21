# Surgical Change Contract

In `services/worker/scripts/prysm-whole-app-gate.js`, invoke the two governed P-B17 scenarios as explicit Whole-App tranches and include P-B17 in the covered branch IDs emitted only after all commands pass.

No report code, fixture content, scoring, evidence semantics, production configuration, or deployment identity logic changes. Fail closed on either scenario failure by retaining the existing `execFileSync` behavior.
