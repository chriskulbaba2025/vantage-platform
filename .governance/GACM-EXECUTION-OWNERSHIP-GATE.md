# GACM Execution Ownership Gate

Status: MANDATORY / FAIL-CLOSED

## Purpose

Prevent governed work from being handed back to the user, Codex, another agent, or another executor while the current execution environment can still perform the next required authorized action.

## Core invariant

THE CURRENT EXECUTOR MUST EXHAUST ITS AVAILABLE AUTHORIZED EXECUTION PATH BEFORE HANDOFF.

The existence of another capable executor is not a handoff condition.

Instructions must never be substituted for execution when execution is available.

## Required execution sequence

For governed work, continue autonomously through:

authority discovery
→ governance preflight
→ diagnosis
→ generalized definition-of-done freeze
→ root-cause isolation
→ repair at the owning producer/contract/consumer boundary
→ targeted regression
→ whole-system regression
→ challenge/generalization gate
→ release currentness and identity verification
→ terminal PASS or proven HOLD

Discovery of another defect, a failing test, an intermediate milestone, additional investigation, or preference for a different tool is not permission to stop.

## Permitted handoff conditions

A handoff is permitted only when the next required action:

1. is technically inaccessible from the current environment;
2. requires credentials or interactive authentication unavailable to the current executor;
3. requires explicit human judgment, approval, or authorization that has not been granted;
4. crosses a protected production, destructive, financial, or otherwise approval-gated boundary; or
5. is blocked by a verified external dependency outside repository/runtime control.

Before any handoff, the executor MUST prove and record:

CURRENT ENVIRONMENT CANNOT EXECUTE THE NEXT REQUIRED ACTION.

The proof must identify:
- the exact next required action;
- the capability/tool checked;
- why that capability cannot perform the action;
- whether another available capability can perform it;
- the minimum user action required, if any.

If that statement cannot be proven, execution continues.

## Prohibited handoff reasons

The following are never sufficient by themselves:

- a defect was found;
- a test failed;
- a repair was made;
- a commit was pushed;
- CI has not yet been inspected;
- another agent could do the work;
- Codex may be more convenient;
- local execution may be preferable;
- more diagnosis is required;
- a prompt could be written for the user;
- an intermediate proof exists.

## Codex/user handoff rule

Do not provide a Codex prompt, shell command, manual checklist, or user instruction as a substitute for an action available to the current executor.

A Codex prompt is permitted only after the handoff proof above passes.

## Terminal states

PASS: all frozen acceptance gates pass for the exact accepted artifact.

HOLD: at least one required gate cannot be completed because of a proven external/inaccessible boundary. HOLD must name one exact blocker and the minimum next action.

PARTIAL PROGRESS is not a terminal governed state.

## Enforcement

Violation of this gate is a governance failure.

Every governed change preflight must read this file. Every closure checklist must include EXECUTION OWNERSHIP: PASS before terminal PASS.
