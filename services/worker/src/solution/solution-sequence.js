import { DISPOSITIONS } from "./solution-contract.js";
import { makeValidationError } from "./solution-validator.js";

function active(record) {
  return [DISPOSITIONS[0], DISPOSITIONS[1]].includes(record.disposition)
    && record.sequenceInputs?.eligibility === true;
}

export function validateSequence(records) {
  const errors = [];
  if (!Array.isArray(records)) return { valid: false, errors: [makeValidationError("V21", null, "records", "Sequence input must be an array.")], sequence: [] };
  const byId = new Map(records.map((record) => [record.solutionId, record]));
  const activeRecords = records.filter(active);
  for (const record of activeRecords) {
    for (const dependency of record.dependencies || []) {
      if (!dependency.targetSolutionId) continue;
      const target = byId.get(dependency.targetSolutionId);
      if (!target) errors.push(makeValidationError("V21", record.solutionId, "dependencies", `Dependency ${dependency.targetSolutionId} does not resolve.`));
      else if (!active(target)) errors.push(makeValidationError("V21", record.solutionId, "dependencies", `Active solution depends on non-active ${dependency.targetSolutionId}.`));
    }
  }

  const state = new Map();
  function visit(record) {
    const current = state.get(record.solutionId) || 0;
    if (current === 1) {
      errors.push(makeValidationError("V22", record.solutionId, "dependencies", "Dependency cycle detected."));
      return;
    }
    if (current === 2) return;
    state.set(record.solutionId, 1);
    for (const dependency of record.dependencies || []) {
      const target = byId.get(dependency.targetSolutionId);
      if (target && active(target)) visit(target);
    }
    state.set(record.solutionId, 2);
  }
  activeRecords.forEach(visit);
  if (errors.length) return { valid: false, errors, sequence: [] };

  const indegree = new Map(activeRecords.map((record) => [record.solutionId, 0]));
  const dependents = new Map(activeRecords.map((record) => [record.solutionId, []]));
  for (const record of activeRecords) for (const dependency of record.dependencies || []) {
    if (!dependency.targetSolutionId || !indegree.has(dependency.targetSolutionId)) continue;
    indegree.set(record.solutionId, indegree.get(record.solutionId) + 1);
    dependents.get(dependency.targetSolutionId).push(record);
  }
  const ready = activeRecords.filter((record) => indegree.get(record.solutionId) === 0);
  const output = [];
  while (ready.length) {
    ready.sort((a, b) => a.sequenceInputs.governedRank - b.sequenceInputs.governedRank);
    const next = ready.shift();
    output.push(next);
    for (const dependent of dependents.get(next.solutionId)) {
      indegree.set(dependent.solutionId, indegree.get(dependent.solutionId) - 1);
      if (indegree.get(dependent.solutionId) === 0) ready.push(dependent);
    }
  }
  return { valid: output.length === activeRecords.length, errors: output.length === activeRecords.length ? [] : [makeValidationError("V22", null, "dependencies", "Dependency cycle prevented a complete sequence.")], sequence: output };
}

export function planSequence(records) {
  const result = validateSequence(records);
  if (!result.valid) return result;
  return { ...result, sequence: result.sequence.map((record) => record.solutionId) };
}
