import test from "node:test";
import assert from "node:assert/strict";
import {
  validateConversionPaths,
  PATH_VALIDATION_STATUS,
} from "./conversion-path-validator.js";

// PRYSM-NEXT-01 WP-E — validator tests with a RECORDING playwright mock.
// Zero live browsers.  The mock records every interaction so the safety
// invariants (no click, no fill, no submit, no external navigation) are
// proven behaviourally, not by source inspection alone.

function makeMockElement(overrides = {}) {
  const calls = { click: 0, fill: 0 };
  return {
    isVisible: async () => overrides.visible ?? true,
    isEnabled: async () => overrides.enabled ?? true,
    textContent: async () => overrides.text ?? "",
    getAttribute: async (name) => overrides.attrs?.[name] ?? null,
    boundingBox: async () => overrides.box ?? null,
    evaluate: async (fn) => (typeof overrides.evaluateResult === "function" ? overrides.evaluateResult() : (overrides.evaluateResult ?? false)),
    click: async () => { calls.click += 1; },
    fill: async () => { calls.fill += 1; },
    _calls: calls,
  };
}

function makeMockPage(overrides = {}) {
  const calls = { gotos: [], screenshots: 0 };
  const cta = overrides.cta || makeMockElement({
    text: "Book Now",
    attrs: { href: "https://x.com/book" },
  });
  const form = overrides.form ?? null;
  const menuToggle = overrides.menuToggle ?? makeMockElement({ text: "menu", visible: true });
  const navLinks = overrides.navLinks ?? [makeMockElement({ text: "Home" }), makeMockElement({ text: "Services" })];
  const fields = overrides.fields ?? [makeMockElement({ text: "name" })];
  const submit = overrides.submit ?? makeMockElement({ text: "Send" });

  return {
    calls,
    async goto(url, opts) {
      calls.gotos.push(String(url));
      if (overrides.gotoThrows) throw new Error(overrides.gotoThrows);
      return { ok: overrides.gotoOk ?? true, status: () => (overrides.gotoStatus ?? 200) };
    },
    async $$(selector) {
      if (selector.includes("nav") || selector.includes("header")) return navLinks;
      if (selector.includes("a[href]")) return [cta];
      if (selector.includes("form")) return [form].filter(Boolean);
      if (selector.includes("input") || selector.includes("textarea")) return fields;
      return [];
    },
    async $(selector) {
      if (selector === "nav, header") return overrides.hasNav === false ? null : makeMockElement({ text: "nav" });
      if (selector === "form") return form;
      if (selector.includes("menu") || selector.includes("hamburger") || selector.includes("toggle")) {
        return overrides.hasToggle === false ? null : menuToggle;
      }
      if (selector.includes("submit")) return submit;
      return null;
    },
    async screenshot() {
      calls.screenshots += 1;
      return Buffer.from("fake-png-bytes");
    },
    async evaluate() { return false; },
    async close() {},
  };
}

function makeMockBrowser(overrides = {}) {
  const page = overrides.page || makeMockPage();
  const destPage = overrides.destPage || makeMockPage({});
  return {
    async newContext() {
      return {
        async newPage() { return page; },
        async close() {},
      };
    },
    async newPage() { return destPage; },
    async close() {},
  };
}

function makeMockPlaywright(overrides = {}) {
  return {
    chromium: {
      launch: async () => {
        if (overrides.launchThrows) throw new Error(overrides.launchThrows);
        return overrides.browser || makeMockBrowser(overrides);
      },
    },
  };
}

const KEY_PAGES = [
  { url: "https://x.com/contact", role: "conversion" },
  { url: "https://x.com/", role: "home" },
];

// ---------------------------------------------------------------------------
// WP-E-01 — core checks
// ---------------------------------------------------------------------------

test("WP-E-01: passing site → PASS status with desktop+mobile checks, screenshot captured", async () => {
  const page = makeMockPage({});
  const pw = makeMockPlaywright({ page });
  const result = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: KEY_PAGES,
    playwrightImpl: pw,
  });

  assert.equal(result.status, PATH_VALIDATION_STATUS.PASS);
  assert.equal(result.pages.length, 2);
  const contact = result.pages[0];
  assert.equal(contact.role, "conversion");
  assert.equal(contact.checks.desktop.cta.found, true);
  assert.equal(contact.checks.desktop.cta.visible, true);
  assert.equal(contact.checks.desktop.cta.interactable, true);
  assert.equal(contact.checks.desktop.cta.target, "https://x.com/book");
  assert.equal(contact.checks.desktop.cta.targetResolves, true);
  assert.equal(contact.checks.desktop.menu.usable, true);
  assert.equal(contact.checks.mobile.menu.usable, true, "mobile toggle usable");
  assert.ok(Buffer.isBuffer(contact._screenshotBuffer), "desktop screenshot captured");
  assert.equal(page.calls.screenshots, 2, "one screenshot per page (desktop pass)");
  assert.equal(result.summary.pass, 2);
});

test("WP-E-01: same-origin destination loads via GET navigation; external target never navigated", async () => {
  const gotoLog = [];
  const page = makeMockPage({});
  const destPage = makeMockPage({
    gotoOk: true,
    gotoStatus: 200,
  });
  destPage.goto = async (url) => { gotoLog.push(String(url)); return { ok: true, status: () => 200 }; };
  const pw = makeMockPlaywright({ page, destPage });

  const internal = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: [{ url: "https://x.com/contact", role: "conversion" }],
    playwrightImpl: pw,
  });
  assert.equal(internal.pages[0].checks.desktop.destination.checked, true);
  assert.equal(internal.pages[0].checks.desktop.destination.loaded, true);
  assert.ok(gotoLog.includes("https://x.com/book"), "same-origin destination was GET-loaded");

  // External CTA target: resolved but never navigated.
  const extCta = makeMockElement({ text: "Book Now", attrs: { href: "https://calendly.example/book" } });
  const extPage = makeMockPage({ cta: extCta });
  const extPw = makeMockPlaywright({ page: extPage });
  const external = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: [{ url: "https://x.com/contact", role: "conversion" }],
    playwrightImpl: extPw,
  });
  assert.equal(external.pages[0].checks.desktop.cta.targetResolves, true);
  assert.equal(external.pages[0].checks.desktop.destination.checked, false, "external targets are never navigated");
  assert.ok(!extPage.calls.gotos.some((u) => u.startsWith("https://calendly")), "no external navigation");
});

test("WP-E-01: obstructed CTA → check fails honestly", async () => {
  const cta = makeMockElement({
    text: "Book Now",
    attrs: { href: "https://x.com/book" },
    evaluateResult: true, // elementFromPoint is NOT the CTA → obstructed
  });
  const page = makeMockPage({ cta });
  const pw = makeMockPlaywright({ page });
  const result = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: [{ url: "https://x.com/contact", role: "conversion" }],
    playwrightImpl: pw,
  });
  assert.equal(result.pages[0].checks.desktop.cta.obstructed, true);
  assert.notEqual(result.pages[0].status, PATH_VALIDATION_STATUS.PASS);
});

test("WP-E-01: page that fails to load → NOT_ASSESSED for that page", async () => {
  const page = makeMockPage({ gotoThrows: "net::ERR_CONNECTION_REFUSED" });
  const pw = makeMockPlaywright({ page });
  const result = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: [{ url: "https://x.com/contact", role: "conversion" }],
    playwrightImpl: pw,
  });
  assert.equal(result.pages[0].status, PATH_VALIDATION_STATUS.NOT_ASSESSED);
  assert.ok(result.pages[0].limitations.some((l) => l.includes("did not load")));
});

test("WP-E-01: browser failure → whole validation NOT_ASSESSED (never a lower score)", async () => {
  const pw = makeMockPlaywright({ launchThrows: "no browser" });
  const result = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: KEY_PAGES,
    playwrightImpl: pw,
  });
  assert.equal(result.status, PATH_VALIDATION_STATUS.NOT_ASSESSED);
  assert.ok(result.limitations.some((l) => l.includes("launch failed")));
});

test("WP-E-01: no playwrightImpl and no allowLiveBrowser → NOT_ASSESSED without launching", async () => {
  const result = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: KEY_PAGES,
    playwrightImpl: null,
    options: { allowLiveBrowser: false },
  });
  assert.equal(result.status, PATH_VALIDATION_STATUS.NOT_ASSESSED);
  assert.ok(result.limitations.some((l) => l.includes("not enabled")));
});

test("WP-E-01: empty key pages → NOT_ASSESSED", async () => {
  const result = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: [],
    playwrightImpl: makeMockPlaywright(),
  });
  assert.equal(result.status, PATH_VALIDATION_STATUS.NOT_ASSESSED);
});

test("CRIT 5a: a weak search-style form never yields a conversion-form PASS", async () => {
  const weakForm = {
    async $$(sel) {
      if (sel.includes("submit")) return [makeMockElement({ text: "Search" })];
      return [makeMockElement({ text: "q" })];
    },
    async $(sel) {
      if (sel.includes("submit")) return makeMockElement({ text: "Search" });
      return null;
    },
  };
  const page = makeMockPage({ form: weakForm });
  const pw = makeMockPlaywright({ page });
  const result = await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: [{ url: "https://x.com/", role: "home" }],
    playwrightImpl: pw,
  });
  const formCheck = result.pages[0].checks.desktop.form;
  assert.equal(formCheck.found, true, "a form exists");
  assert.equal(formCheck.submitEnabled, null, "submit intent too weak — stays unknown");
  assert.ok(formCheck.limitation && formCheck.limitation.includes("conversion-relevant"), "limitation recorded");
});

// ---------------------------------------------------------------------------
// WP-E-02 — form-safety invariant (behavioural)
// ---------------------------------------------------------------------------

test("WP-E-02: no click, no fill, no submit across any scenario", async () => {
  const cta = makeMockElement({ text: "Book Now", attrs: { href: "https://x.com/book" } });
  const formCalls = { submit: 0 };
  const form = {
    async $$(sel) {
      if (sel.includes("submit")) return [makeMockElement({ text: "Send" })];
      return [makeMockElement({ text: "name" })];
    },
    async $(sel) {
      if (sel.includes("submit")) return makeMockElement({ text: "Send" });
      return null;
    },
    async evaluate() { return false; },
    _calls: formCalls,
  };
  const page = makeMockPage({ cta, form });
  const pw = makeMockPlaywright({ page });

  await validateConversionPaths({
    targetUrl: "https://x.com",
    keyPages: KEY_PAGES,
    playwrightImpl: pw,
  });

  assert.equal(cta._calls.click, 0, "CTA click() never invoked");
  assert.equal(cta._calls.fill, 0, "fill() never invoked");
  assert.equal(formCalls.submit, 0, "no submit interaction");
});
