import test from "node:test";
import assert from "node:assert/strict";
import { validateNewAuditIntake } from "./intake-contract.js";

const complete = {
  targetUrl: "https://example.com",
  businessName: "Example",
  market: "Canada",
  primaryGoal: "Generate enquiries",
  services: ["Consulting"],
};

test("new intake accepts complete business context", () => {
  assert.deepEqual(validateNewAuditIntake(complete).services, ["Consulting"]);
});

for (const field of ["market", "primaryGoal", "services"]) {
  test(`new intake rejects missing ${field}`, () => {
    const input = { ...complete };
    if (field === "services") input.services = [];
    else input[field] = "";
    assert.throws(
      () => validateNewAuditIntake(input),
      (error) => error.code === "INTAKE_REQUIRED_CONTEXT" && error.errors.some((item) => item.field === field),
    );
  });
}

test("recovery contract remains separate from new-intake validation", () => {
  assert.equal(validateNewAuditIntake.name, "validateNewAuditIntake");
});


test("new intake governs supplied idempotency keys without requiring them for historical compatibility", () => {
  assert.equal(
    validateNewAuditIntake({ ...complete, idempotencyKey: "audit-retry-001" }).idempotencyKey,
    "audit-retry-001",
  );
  assert.throws(
    () => validateNewAuditIntake({ ...complete, idempotencyKey: "short" }),
    (error) =>
      error.code === "INTAKE_REQUIRED_CONTEXT" &&
      error.errors.some((item) => item.field === "idempotencyKey"),
  );
  assert.doesNotThrow(() => validateNewAuditIntake(complete));
});


test("new intake returns normalized business context for canonical persistence", () => {
  const normalized = validateNewAuditIntake({
    ...complete,
    market: "  London, Ontario  ",
    primaryGoal: "  Generate enquiries  ",
    services: [" Consulting ", " ", "Advisory"],
  });
  assert.equal(normalized.market, "London, Ontario");
  assert.equal(normalized.primaryGoal, "Generate enquiries");
  assert.deepEqual(normalized.services, ["Consulting", "Advisory"]);
});
