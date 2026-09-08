import {
  CLIENT_TRUTH_STATE,
  requireClientTruth,
} from "./cross-report-interpretation.js";

const ALLOWED_STATES = new Set(
  Object.values(CLIENT_TRUTH_STATE),
);

const PLACEHOLDER_PATTERN =
  /\b(?:undefined|null|nan)\b|\$\{[^}]+\}|\{\{[^}]+\}\}/i;

const UNASSESSED_UPGRADE_PATTERN =
  /\bpass\b|\bno blocker\b|\bno action required\b|\bdoes not exist\b|\bnone exists\b|\b(?:is|are|was|were)\s+(?:absent|missing)\b/i;

const PARTIAL_CERTAINTY_PATTERN =
  /\bsite[- ]wide\b|\bentire site\b|\ball pages\b|\bfully assessed\b|\bcompletely assessed\b/i;

function text(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalized(value) {
  return text(value)
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasPlaceholder(value) {
  return (
    typeof value === "string" &&
    PLACEHOLDER_PATTERN.test(value)
  );
}

function push(errors, path, message) {
  errors.push({
    path,
    message,
  });
}

function validateTruthRecord(
  key,
  record,
  errors,
) {
  const base =
    `crossReportInterpretation.truth.${key}`;

  if (
    !record ||
    typeof record !== "object"
  ) {
    push(
      errors,
      base,
      "Client Truth record is missing.",
    );
    return;
  }

  if (
    !ALLOWED_STATES.has(
      record.state,
    )
  ) {
    push(
      errors,
      `${base}.state`,
      "Client Truth state is invalid.",
    );
  }

  for (const field of [
    "scope",
    "observation",
    "clientConclusion",
  ]) {
    if (!text(record[field])) {
      push(
        errors,
        `${base}.${field}`,
        `${field} must be a non-empty string.`,
      );
    } else if (
      hasPlaceholder(
        record[field],
      )
    ) {
      push(
        errors,
        `${base}.${field}`,
        `${field} contains an unresolved placeholder.`,
      );
    }
  }

  if (
    record.qualifier !== null &&
    record.qualifier !== undefined &&
    !text(record.qualifier)
  ) {
    push(
      errors,
      `${base}.qualifier`,
      "Qualifier must be null or a non-empty string.",
    );
  }

  if (
    hasPlaceholder(
      record.qualifier,
    )
  ) {
    push(
      errors,
      `${base}.qualifier`,
      "Qualifier contains an unresolved placeholder.",
    );
  }

  if (
    !Array.isArray(
      record.prohibitedUpgrades,
    )
  ) {
    push(
      errors,
      `${base}.prohibitedUpgrades`,
      "prohibitedUpgrades must be an array.",
    );
  }

  if (
    !Array.isArray(
      record.evidenceRefs,
    ) ||
    record.evidenceRefs.length === 0
  ) {
    push(
      errors,
      `${base}.evidenceRefs`,
      "Every Client Truth record requires evidence lineage.",
    );
  }

  const conclusion =
    text(
      record.clientConclusion,
    );

  if (
    record.state ===
      CLIENT_TRUTH_STATE.NOT_ASSESSED &&
    UNASSESSED_UPGRADE_PATTERN.test(
      conclusion,
    )
  ) {
    push(
      errors,
      `${base}.clientConclusion`,
      "Not-assessed evidence was upgraded into a positive, negative, or no-action conclusion.",
    );
  }

  if (
    record.state ===
      CLIENT_TRUTH_STATE.PARTIAL
  ) {
    if (
      !text(record.qualifier)
    ) {
      push(
        errors,
        `${base}.qualifier`,
        "Partial Client Truth requires explicit bounded-scope qualification.",
      );
    }

    if (
      PARTIAL_CERTAINTY_PATTERN.test(
        conclusion,
      )
    ) {
      push(
        errors,
        `${base}.clientConclusion`,
        "Partial evidence was upgraded into complete or site-wide certainty.",
      );
    }
  }

  if (
    record.state ===
      CLIENT_TRUTH_STATE.NOT_APPLICABLE &&
    !/not applicable/i.test(
      `${record.observation} ${record.clientConclusion}`,
    )
  ) {
    push(
      errors,
      base,
      "NOT_APPLICABLE requires an affirmative not-applicable conclusion.",
    );
  }

  for (
    const prohibited
    of record.prohibitedUpgrades || []
  ) {
    const phrase =
      normalized(prohibited);

    if (
      phrase &&
      normalized(
        record.clientConclusion,
      ).includes(phrase)
    ) {
      push(
        errors,
        `${base}.clientConclusion`,
        `Client conclusion contains prohibited upgrade: ${prohibited}`,
      );
    }
  }

  for (const field of [
    "businessMeaning",
    "recommendedAction",
  ]) {
    if (
      record[field] !== null &&
      record[field] !== undefined &&
      !text(record[field])
    ) {
      push(
        errors,
        `${base}.${field}`,
        `${field} must be null or a non-empty string.`,
      );
    }

    if (
      hasPlaceholder(
        record[field],
      )
    ) {
      push(
        errors,
        `${base}.${field}`,
        `${field} contains an unresolved placeholder.`,
      );
    }
  }
}

function validateActions(
  actions,
  errors,
) {
  if (!Array.isArray(actions)) {
    push(
      errors,
      "crossReportInterpretation.actions",
      "Client Truth actions must be an array.",
    );
    return;
  }

  const ranks = new Set();
  const findingIds = new Set();

  for (
    let index = 0;
    index < actions.length;
    index += 1
  ) {
    const action =
      actions[index];

    const base =
      `crossReportInterpretation.actions[${index}]`;

    if (
      !action ||
      typeof action !== "object"
    ) {
      push(
        errors,
        base,
        "Client Truth action must be an object.",
      );
      continue;
    }

    for (const field of [
      "findingId",
      "ruleId",
      "group",
      "impactLabel",
      "businessReason",
    ]) {
      if (!text(action[field])) {
        push(
          errors,
          `${base}.${field}`,
          `${field} is required.`,
        );
      } else if (
        hasPlaceholder(
          action[field],
        )
      ) {
        push(
          errors,
          `${base}.${field}`,
          `${field} contains an unresolved placeholder.`,
        );
      }
    }

    if (
      !Number.isInteger(
        action.rank,
      ) ||
      action.rank < 1
    ) {
      push(
        errors,
        `${base}.rank`,
        "Action rank must be a positive integer.",
      );
    } else if (
      ranks.has(
        action.rank,
      )
    ) {
      push(
        errors,
        `${base}.rank`,
        "Action ranks must be unique.",
      );
    } else {
      ranks.add(
        action.rank,
      );
    }

    if (
      text(
        action.findingId,
      )
    ) {
      if (
        findingIds.has(
          action.findingId,
        )
      ) {
        push(
          errors,
          `${base}.findingId`,
          "A finding may appear only once in the Client Truth action hierarchy.",
        );
      }

      findingIds.add(
        action.findingId,
      );
    }

    for (const field of [
      "recommendation",
      "verificationMethod",
    ]) {
      if (
        action[field] !== null &&
        action[field] !== undefined &&
        !text(action[field])
      ) {
        push(
          errors,
          `${base}.${field}`,
          `${field} must be null or a non-empty string.`,
        );
      }

      if (
        hasPlaceholder(
          action[field],
        )
      ) {
        push(
          errors,
          `${base}.${field}`,
          `${field} contains an unresolved placeholder.`,
        );
      }
    }
  }

  if (
    actions.length > 0
  ) {
    const expected =
      Array.from(
        {
          length:
            actions.length,
        },
        (_, index) =>
          index + 1,
      );

    const observed =
      [...ranks].sort(
        (a, b) => a - b,
      );

    if (
      JSON.stringify(
        expected,
      ) !==
      JSON.stringify(
        observed,
      )
    ) {
      push(
        errors,
        "crossReportInterpretation.actions",
        "Client Truth action ranks must form one contiguous 1..N hierarchy.",
      );
    }
  }
}

export function validateClientTruth(
  projection,
) {
  const errors = [];

  let verified;

  try {
    verified =
      requireClientTruth({
        crossReportInterpretation:
          projection,
      });
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          path:
            "crossReportInterpretation",
          message:
            error.message,
        },
      ],
    };
  }

  for (
    const [
      key,
      record,
    ]
    of Object.entries(
      verified.truth,
    )
  ) {
    validateTruthRecord(
      key,
      record,
      errors,
    );
  }

  validateActions(
    verified.actions,
    errors,
  );

  return {
    valid:
      errors.length === 0,
    errors,
  };
}

export function requireClientTruthIntegrity(
  model,
) {
  const projection =
    requireClientTruth(
      model,
    );

  const result =
    validateClientTruth(
      projection,
    );

  if (!result.valid) {
    const details =
      result.errors
        .map(
          (error) =>
            `${error.path}: ${error.message}`,
        )
        .join("; ");

    throw new Error(
      `Client Truth integrity gate failed: ${details}`,
    );
  }

  return projection;
}