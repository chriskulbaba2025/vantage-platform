# Decisions

- GitHub is authoritative durable project memory.
- Current release intent is STAGING_READY.
- Unknown evidence is not absence.
- A successful provider request with zero usable records is UNAVAILABLE/no-data, not AVAILABLE.
- Named audits such as Reboot are regression fixtures, never implementation targets.
- Repair evidence semantics at the owning producer/contract/consumer boundary, not in report copy.
- Execution ownership is fail-closed: the current executor performs every available authorized action before handoff.
- The existence of Codex, another agent, or a preferable environment is not a handoff condition.
- A handoff requires proof that the exact next required action is technically inaccessible, lacks required credentials/interactive authentication, requires ungranted human authorization/judgment, crosses a protected boundary, or is externally blocked.
- A defect, failed test, intermediate commit, or need for more diagnosis is never a terminal state.
