# Diagnostic and Design Gap

The prior checkpoint had deterministic evidence reconciliation, graph contracts,
repositories, and Ask PRYSM query handlers, but the production audit
orchestrator did not produce or persist record-level evidence/graph state and
server composition did not inject the same repository into both the runtime and
Ask PRYSM.

Root cause: the new contracts stopped at isolated module boundaries. The
smallest generalized repair is to project the already-validated SourceResults
after decision-evidence hydration, reconcile them, persist them and the graph,
and inject one scoped repository at composition time. No provider or report
contract is replaced.

