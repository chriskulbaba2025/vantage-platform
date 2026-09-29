/**
 * GACM PRYSM v2 print/PDF acceptance.
 *
 * Generates a current render through the frozen renderer matrix, opens that
 * exact HTML in real headless Chromium, activates the full-report print path,
 * verifies all seven conceptual pages are exposed in governed order, and
 * produces a real PDF. No provider or LLM calls.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const EXPECTED_PAGES = [
  ["executive-scorecard", "Executive Scorecard"],
  ["priority-fixes", "Priority Fixes"],
  ["conversion-paths", "Conversion Journey"],
  ["trust-eeat", "Trust & Credibility"],
  ["competitor-benchmark", "Competitor Comparison"],
  ["content-ideas", "Content Opportunities"],
  ["supporting-detail", "Supporting Detail"],
];

const proofDir = await mkdtemp(join(tmpdir(), "prysm-v2-pdf-"));

try {
  execFileSync(
    process.execPath,
    ["--test", "src/report/render-report-v2-conversion.test.js"],
    {
      cwd: resolve("."),
      stdio: "inherit",
      env: {
        ...process.env,
        P1_RENDER_PROOF_DIR: proofDir,
        P1_APPLICATION_SHA: process.env.GITHUB_SHA || "LOCAL",
      },
    },
  );

  const htmlPath = join(proofDir, "assessed.html");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "domcontentloaded" });

    const viewerPages = await page.evaluate(() => {
      const seen = new Set();
      const pages = [];
      for (const node of document.querySelectorAll("a[data-viewer-page]")) {
        const pageId = node.getAttribute("data-viewer-page");
        if (!pageId || seen.has(pageId)) continue;
        seen.add(pageId);
        const titleNode = Array.from(node.querySelectorAll("span"))
          .find((span) => !span.classList.contains("viewer-nav-num"));
        pages.push([pageId, (titleNode?.textContent || "").trim()]);
      }
      return pages;
    });
    assert.deepEqual(
      viewerPages,
      EXPECTED_PAGES,
      "viewer must expose exactly seven governed pages with approved client titles in order",
    );

    await page.evaluate(() => {
      window.print = () => {};
      if (typeof window.printFullReport !== "function") {
        throw new Error("printFullReport is not available");
      }
      window.printFullReport();
    });

    await page.emulateMedia({ media: "print" });

    const printState = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll("main > section.viewer-section"));
      return {
        fullReport: document.body.classList.contains("print-full-report"),
        visibleSections: sections.filter((section) => getComputedStyle(section).display !== "none").length,
        totalSections: sections.length,
        pageStarts: sections.filter((section) => section.classList.contains("print-page-start")).length,
        ordered: sections.every((section) => /^\d+$/.test(section.style.order)),
        toolbarDisplay: getComputedStyle(document.querySelector(".viewer-toolbar")).display,
        sidebarDisplay: getComputedStyle(document.querySelector(".viewer-sidebar")).display,
      };
    });

    assert.equal(printState.fullReport, true, "full-report print mode must be active");
    assert.ok(printState.totalSections > 0, "report must contain governed sections");
    assert.equal(printState.visibleSections, printState.totalSections, "all governed sections must be printable");
    assert.equal(printState.pageStarts, EXPECTED_PAGES.length - 1, "six page breaks must separate seven conceptual pages");
    assert.equal(printState.ordered, true, "all printable sections must receive governed print order");
    assert.equal(printState.toolbarDisplay, "none", "print toolbar must not appear in PDF");
    assert.equal(printState.sidebarDisplay, "none", "viewer navigation must not appear in PDF");

    const pdfPath = join(proofDir, "prysm-seven-page-report.pdf");
    await page.pdf({
      path: pdfPath,
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
    });

    const pdf = await readFile(pdfPath);
    assert.ok(pdf.length > 50_000, "generated PDF must contain substantial rendered content");
    const physicalPages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
    assert.ok(physicalPages >= 7, `PDF must contain at least seven physical pages; got ${physicalPages}`);

    process.stdout.write(
      `PRYSM V2 PDF ACCEPTANCE: PASS — conceptualPages=7 physicalPages=${physicalPages} bytes=${pdf.length}\n`,
    );
  } finally {
    await browser.close();
  }
} finally {
  await rm(proofDir, { recursive: true, force: true });
}
