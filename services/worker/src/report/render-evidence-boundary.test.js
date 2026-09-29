import test from "node:test";
import assert from "node:assert/strict";
import { renderUnavailablePage, shouldRenderUnavailablePage } from "./render-evidence-boundary.js";

function page(pageId) {
  return { pageId, secNum: "09", title: "Test Page", sectionId: "test-section" };
}

test("failed website evidence uses the shared unavailable renderer boundary", () => {
  const model = {
    sourceStatus: { website: "FAILED", performance: "FAILED" },
    evidence: {
      site: { sourceStatus: "FAILED", limitations: ["crawl failed"] },
      performance: { sourceStatus: "FAILED", limitations: ["performance unavailable"] },
    },
  };

  assert.equal(shouldRenderUnavailablePage(model, "technical-seo"), true);
  const html = renderUnavailablePage(model, page("technical-seo"));
  assert.match(html, /Status: FAILED/);
  assert.match(html, /No positive or negative website conclusion/);
  assert.match(html, /crawl failed/);
});

test("partial performance without measurable scores remains not assessed", () => {
  const model = {
    sourceStatus: { website: "AVAILABLE", performance: "PARTIAL" },
    evidence: {
      site: { sourceStatus: "AVAILABLE" },
      performance: { sourceStatus: "PARTIAL", limitations: ["no usable score"] },
    },
    capabilityEvidence: {
      capabilities: {
        "performance.lab": {
          status: "PARTIAL",
          requiredFieldsPresent: false,
        },
      },
    },
  };

  assert.equal(shouldRenderUnavailablePage(model, "performance"), true);
  assert.match(renderUnavailablePage(model, page("performance")), /Status: PARTIAL/);
});

test("available complete evidence keeps the existing page renderer path", () => {
  const model = {
    sourceStatus: { website: "AVAILABLE", performance: "AVAILABLE" },
    evidence: {
      site: { sourceStatus: "AVAILABLE" },
      performance: { sourceStatus: "AVAILABLE" },
    },
    capabilityEvidence: {
      capabilities: {
        "content.body": { status: "AVAILABLE", requiredFieldsPresent: true },
        "offer.clarity": { status: "AVAILABLE", requiredFieldsPresent: true },
        "trust.proof": { status: "AVAILABLE", requiredFieldsPresent: true },
        "performance.lab": { status: "AVAILABLE", requiredFieldsPresent: true },
      },
    },
  };

  assert.equal(shouldRenderUnavailablePage(model, "content-ideas"), false);
  assert.equal(shouldRenderUnavailablePage(model, "trust-eeat"), false);
  assert.equal(shouldRenderUnavailablePage(model, "performance"), false);
});

