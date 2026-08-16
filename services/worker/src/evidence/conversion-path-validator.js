/**
 * PRYSM-NEXT-01 WP-E — Functional Conversion-Path Validator
 *
 * A NARROW Playwright-based validation layer for selected decision-bearing
 * pages.  It verifies, per page (desktop + mobile):
 *   - CTA visible + interactable + target resolvable
 *   - navigation menu available (links visible on desktop; toggle on mobile)
 *   - conversion form renders with editable fields + enabled submit control
 *   - overlays do not obstruct the CTA (hit-test at CTA center)
 *   - same-origin destinations load (GET navigation only)
 *
 * HARD SAFETY INVARIANTS:
 *   - NEVER clicks a CTA, link, or submit control.
 *   - NEVER fills fields, dispatches submit events, or performs POST
 *     navigation.  All interaction is read-only observation.
 *   - External targets are resolved (attribute parsing) but never navigated.
 *   - Browser/playwright failure ⇒ NOT_ASSESSED (never a lower score).
 *
 * Tests inject a recording playwright mock (`playwrightImpl`); production
 * passes `allowLiveBrowser: true` explicitly.  Without either, the validator
 * refuses to run (zero uncontrolled browser access).
 */

import { normalizeUrl } from "./important-page-selector.js";

export const PATH_VALIDATION_STATUS = Object.freeze({
  PASS: "PASS",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  NOT_ASSESSED: "NOT_ASSESSED",
});

export const PATH_VALIDATION_PROVIDER = "playwright-conversion-path";

const CTA_TEXT_RE =
  /\b(book|schedule|contact|call|subscribe|buy|start|get started|learn more|request|download|join|register|sign up|free consultation|discovery|quote|enquir|reserve|appointment)\b/i;

const CTA_SELECTORS = ["a[href]", "button", '[role="button"]', '[role="link"]'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notAssessedPage(url, role, limitation) {
  return {
    url,
    role,
    checks: {
      cta: { found: null, visible: null, interactable: null, target: null, targetResolves: null, obstructed: null },
      menu: { found: null, usable: null },
      form: { found: null, fieldsEditable: null, submitEnabled: null },
      destination: { checked: null, loaded: null },
    },
    status: PATH_VALIDATION_STATUS.NOT_ASSESSED,
    limitations: [limitation],
    screenshotRef: null,
  };
}

async function tryScreenshot(page, enabled) {
  if (!enabled) return null;
  try {
    const buffer = await page.screenshot();
    return Buffer.isBuffer(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

/** Parse the CTA target from href/action; never navigate externally. */
function resolveTarget(href, pageUrl) {
  if (!href || typeof href !== "string") return { target: null, targetResolves: false, sameOrigin: false };
  try {
    const target = new URL(href, pageUrl).toString();
    const sameOrigin = (() => {
      try {
        return new URL(target).origin === new URL(pageUrl).origin;
      } catch {
        return false;
      }
    })();
    return { target, targetResolves: true, sameOrigin };
  } catch {
    return { target: href, targetResolves: false, sameOrigin: false };
  }
}

/** Hit-test: does the element at the CTA's center belong to the CTA? */
async function isObstructed(page, cta) {
  try {
    return await cta.evaluate((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return null;
      const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      if (!at) return null;
      return !(at === el || el.contains(at));
    });
  } catch {
    return null;
  }
}

async function checkCta(page, pageUrl) {
  const result = { found: false, visible: null, interactable: null, target: null, targetResolves: null, obstructed: null };
  let cta = null;
  for (const sel of CTA_SELECTORS) {
    const els = await page.$$(sel);
    for (const el of els) {
      let text = "";
      try {
        text = (await el.textContent()) || "";
      } catch { /* keep empty */ }
      if (CTA_TEXT_RE.test(text)) {
        cta = el;
        break;
      }
    }
    if (cta) break;
  }
  if (!cta) return result;

  result.found = true;
  try { result.visible = await cta.isVisible(); } catch { result.visible = null; }
  try {
    result.interactable = result.visible === true ? (await cta.isEnabled()) : false;
  } catch { result.interactable = null; }

  let href = null;
  try { href = await cta.getAttribute("href"); } catch { /* no href */ }
  if (!href) {
    try { href = await cta.getAttribute("action"); } catch { /* no action */ }
  }
  const resolved = resolveTarget(href, pageUrl);
  result.target = resolved.target;
  result.targetResolves = resolved.targetResolves;
  result.obstructed = await isObstructed(page, cta);
  return { ...result, _resolved: resolved, _cta: cta };
}

async function checkMenu(page, mobileViewport) {
  const result = { found: false, usable: null };
  try {
    const nav = await page.$("nav, header");
    result.found = Boolean(nav);
    if (nav) {
      if (mobileViewport) {
        const toggle = await page.$(
          'button[aria-label*="menu" i], button[aria-label*="nav" i], .hamburger, .menu-toggle, [class*="menu"][class*="toggle"], [class*="hamburger"]',
        );
        const toggleVisible = toggle ? await toggle.isVisible() : false;
        result.usable = Boolean(toggleVisible);
      } else {
        const links = await page.$$("nav a[href], header a[href]");
        let visibleCount = 0;
        for (const link of links) {
          if (await link.isVisible()) visibleCount += 1;
        }
        result.usable = visibleCount >= 2;
      }
    }
  } catch {
    result.usable = null;
  }
  return result;
}

// CRIT defect 5a — a header-search or newsletter form must NOT satisfy
// "conversion form renders".  A form is conversion-relevant only when its
// submit control carries conversion intent OR it has multiple editable
// fields.  Weak evidence stays unknown (submitEnabled null + limitation),
// never a false PASS.
const CONVERSION_SUBMIT_RE =
  /\b(submit|send|book|contact|request|enquir|inquir|sign|subscribe|apply|start|continue|quote|reserve|join|get started)\b/i;

async function checkForm(page) {
  const result = { found: false, fieldsEditable: null, submitEnabled: null, limitation: null };
  try {
    const forms = await page.$$("form");
    result.found = forms.length > 0;
    let selected = null;
    let selectedFieldsEditable = null;
    let selectedSubmitEnabled = null;
    let selectedLimitation = null;

    for (const form of forms) {
      const fields = await form.$$("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select");
      let editable = 0;
      for (const f of fields) {
        try {
          if ((await f.isVisible()) && (await f.isEnabled())) editable += 1;
        } catch { /* skip */ }
      }
      const submit = await form.$('input[type="submit"], button[type="submit"], button:not([type="button"])');
      let submitText = "";
      let submitEnabled = null;
      if (submit) {
        try {
          submitText = (await submit.textContent()) || "";
          submitEnabled = (await submit.isVisible()) && (await submit.isEnabled());
        } catch { submitEnabled = null; }
      }
      const conversionRelevant = CONVERSION_SUBMIT_RE.test(submitText) || editable >= 2;
      if (conversionRelevant) {
        selected = form;
        selectedFieldsEditable = editable > 0;
        selectedSubmitEnabled = submitEnabled;
        selectedLimitation = null;
        break;
      }
      // Remember the first weak form so we can report it honestly.
      if (!selected && !selectedLimitation) {
        selected = form;
        selectedFieldsEditable = editable > 0;
        selectedSubmitEnabled = null;
        selectedLimitation = "No conversion-relevant form identified (submit text/intent too weak to claim conversion readiness)";
      }
    }

    if (selected) {
      result.fieldsEditable = selectedFieldsEditable;
      result.submitEnabled = selectedSubmitEnabled;
      result.limitation = selectedLimitation;
    }
  } catch {
    result.fieldsEditable = null;
  }
  return result;
}

async function checkDestination(page, resolved, browser) {
  const result = { checked: false, loaded: null };
  if (!resolved || !resolved.targetResolves || !resolved.sameOrigin) {
    result.checked = false;
    return result;
  }
  result.checked = true;
  let destPage = null;
  try {
    destPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const response = await destPage.goto(resolved.target, { waitUntil: "domcontentloaded", timeout: 20000 });
    result.loaded = Boolean(response && response.ok && response.status() < 400);
  } catch {
    result.loaded = false;
  } finally {
    if (destPage) {
      try { await destPage.close(); } catch { /* ignore */ }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Per-page validation
// ---------------------------------------------------------------------------

async function validatePage(browser, keyPage, opts) {
  const { url, role } = keyPage;
  const mobile = opts.mobile ?? true;
  const screenshots = opts.screenshots ?? true;
  const timeouts = { gotoTimeoutMs: opts.gotoTimeoutMs ?? 20000 };

  const pageChecks = { desktop: null, mobile: null };
  const limitations = [];
  let screenshotRef = null;

  const runPass = async (viewport, label) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: timeouts.gotoTimeoutMs });
    } catch (err) {
      await ctx.close();
      return { loadable: false, limitation: `Page did not load: ${err.message}` };
    }
    try {
      const cta = await checkCta(page, url);
      const menu = await checkMenu(page, label === "mobile");
      const form = await checkForm(page);
      const destination = await checkDestination(page, cta._resolved || null, browser);
      if (label === "desktop" && screenshots) {
        const shot = await tryScreenshot(page, screenshots);
        if (shot) screenshotRef = shot;
      }
      const passCount = [cta.found && cta.visible && cta.interactable && !cta.obstructed, menu.usable, form.found === false ? null : form.fieldsEditable, destination.loaded].filter((v) => v === true).length;
      const failCount = [cta.visible === false || cta.interactable === false || cta.obstructed === true || !cta.found, menu.usable === false, form.fieldsEditable === false || form.submitEnabled === false, destination.loaded === false].filter(Boolean).length;
      const checks = {
        cta: { found: cta.found, visible: cta.visible, interactable: cta.interactable, target: cta.target, targetResolves: cta.targetResolves, obstructed: cta.obstructed },
        menu,
        form,
        destination,
      };
      await ctx.close();
      return { loadable: true, checks, passCount, failCount };
    } catch (err) {
      try { await ctx.close(); } catch { /* ignore */ }
      return { loadable: true, limitation: `Check evaluation failed: ${err.message}` };
    }
  };

  const desktopResult = await runPass({ width: 1440, height: 1000 }, "desktop");
  if (desktopResult.limitation) limitations.push(`desktop: ${desktopResult.limitation}`);
  if (desktopResult.loadable === false) {
    return notAssessedPage(url, role, limitations.join("; ") || "Page did not load");
  }
  pageChecks.desktop = desktopResult.checks || null;

  if (mobile) {
    const mobileResult = await runPass({ width: 390, height: 844 }, "mobile");
    if (mobileResult.limitation) limitations.push(`mobile: ${mobileResult.limitation}`);
    if (mobileResult.loadable === false) {
      limitations.push("mobile: page did not load");
    } else {
      pageChecks.mobile = mobileResult.checks || null;
    }
  }

  // Status: PASS when every assessed check passed; PARTIAL when some
  // passed and some failed; FAILED when assessed checks all failed;
  // NOT_ASSESSED when nothing could be assessed.
  const assessed = [pageChecks.desktop, pageChecks.mobile].filter(Boolean);
  if (assessed.length === 0) {
    return notAssessedPage(url, role, limitations.join("; ") || "No checks could be assessed");
  }
  let passCount = 0;
  let failCount = 0;
  for (const checks of assessed) {
    const c = checks.cta || {};
    if (c.found && c.visible && c.interactable && !c.obstructed) passCount += 1; else failCount += 1;
    if (checks.menu?.usable === true) passCount += 1; else if (checks.menu?.usable === false) failCount += 1;
    // A form check counts only when the form was conversion-relevant
    // (CRIT defect 5a — weak forms stay unknown, not pass and not fail).
    if (checks.form?.found === true && !checks.form.limitation) {
      if (checks.form.fieldsEditable === true && checks.form.submitEnabled !== false) passCount += 1;
      else failCount += 1;
    }
    if (checks.destination?.checked === true) {
      if (checks.destination.loaded === true) passCount += 1; else failCount += 1;
    }
  }

  const status = failCount === 0
    ? PATH_VALIDATION_STATUS.PASS
    : passCount === 0
      ? PATH_VALIDATION_STATUS.FAILED
      : PATH_VALIDATION_STATUS.PARTIAL;

  return {
    url,
    role,
    checks: pageChecks,
    status,
    limitations,
    screenshotRef: null,
    _screenshotBuffer: screenshotRef,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Validate conversion paths on selected decision-bearing pages.
 *
 * @param {object} opts
 * @param {string} opts.targetUrl
 * @param {Array<{url: string, role?: string}>} opts.keyPages
 * @param {object|null} [opts.playwrightImpl] - injected playwright (tests)
 * @param {object} [opts.options]
 * @returns {Promise<{ provider, status, pages, summary, limitations }>}
 */
export async function validateConversionPaths({ targetUrl, keyPages = [], playwrightImpl = null, options = {} }) {
  const pageLimit = options.pageLimit ?? 6;
  const allowLiveBrowser = options.allowLiveBrowser ?? false;
  const limitations = [];

  if (!keyPages || keyPages.length === 0) {
    return {
      provider: PATH_VALIDATION_PROVIDER,
      status: PATH_VALIDATION_STATUS.NOT_ASSESSED,
      pages: [],
      summary: { requested: 0, pass: 0, partial: 0, failed: 0, notAssessed: 0 },
      limitations: ["No decision-bearing pages supplied — validation not attempted"],
    };
  }

  let chromium = null;
  if (playwrightImpl?.chromium) {
    chromium = playwrightImpl.chromium;
  } else if (allowLiveBrowser) {
    try {
      ({ chromium } = await import("playwright"));
    } catch (err) {
      return {
        provider: PATH_VALIDATION_PROVIDER,
        status: PATH_VALIDATION_STATUS.NOT_ASSESSED,
        pages: keyPages.slice(0, pageLimit).map((kp) => notAssessedPage(kp.url, kp.role, "playwright import failed")),
        summary: { requested: keyPages.length, pass: 0, partial: 0, failed: 0, notAssessed: keyPages.length },
        limitations: [`playwright import failed: ${err.message}`],
      };
    }
  } else {
    return {
      provider: PATH_VALIDATION_PROVIDER,
      status: PATH_VALIDATION_STATUS.NOT_ASSESSED,
      pages: keyPages.slice(0, pageLimit).map((kp) => notAssessedPage(kp.url, kp.role, "browser validation not enabled")),
      summary: { requested: keyPages.length, pass: 0, partial: 0, failed: 0, notAssessed: keyPages.length },
      limitations: ["Browser validation not enabled for this run"],
    };
  }

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    return {
      provider: PATH_VALIDATION_PROVIDER,
      status: PATH_VALIDATION_STATUS.NOT_ASSESSED,
      pages: keyPages.slice(0, pageLimit).map((kp) => notAssessedPage(kp.url, kp.role, "browser launch failed")),
      summary: { requested: keyPages.length, pass: 0, partial: 0, failed: 0, notAssessed: keyPages.length },
      limitations: [`Browser launch failed: ${err.message}`],
    };
  }

  const pages = [];
  try {
    for (const kp of keyPages.slice(0, pageLimit)) {
      pages.push(await validatePage(browser, kp, options));
    }
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }

  const summary = {
    requested: Math.min(keyPages.length, pageLimit),
    pass: pages.filter((p) => p.status === PATH_VALIDATION_STATUS.PASS).length,
    partial: pages.filter((p) => p.status === PATH_VALIDATION_STATUS.PARTIAL).length,
    failed: pages.filter((p) => p.status === PATH_VALIDATION_STATUS.FAILED).length,
    notAssessed: pages.filter((p) => p.status === PATH_VALIDATION_STATUS.NOT_ASSESSED).length,
  };

  const status = summary.pass + summary.partial === 0
    ? (summary.failed > 0 ? PATH_VALIDATION_STATUS.FAILED : PATH_VALIDATION_STATUS.NOT_ASSESSED)
    : summary.failed > 0 || summary.partial > 0
      ? PATH_VALIDATION_STATUS.PARTIAL
      : PATH_VALIDATION_STATUS.PASS;

  return { provider: PATH_VALIDATION_PROVIDER, status, pages, summary, limitations };
}

export default { validateConversionPaths, PATH_VALIDATION_STATUS, PATH_VALIDATION_PROVIDER };
