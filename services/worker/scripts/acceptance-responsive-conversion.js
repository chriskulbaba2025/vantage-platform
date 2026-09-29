/**
 * GACM responsive conversion-path acceptance.
 *
 * Uses a local deterministic HTTP page and real Chromium. Proves that
 * responsive duplicate controls are selected by visibility instead of DOM
 * order, with zero form submission and zero external/provider calls.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { validateConversionPaths, PATH_VALIDATION_STATUS } from "../src/evidence/conversion-path-validator.js";

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    .mobile-cta, .menu-toggle { display:none; }
    @media (max-width:600px) {
      .desktop-cta, .desktop-link { display:none; }
      .mobile-cta, .menu-toggle { display:inline-block; }
    }
  </style>
</head>
<body>
  <nav>
    <a class="desktop-link" href="/">Home</a>
    <a class="desktop-link" href="/services">Services</a>
  </nav>
  <button class="menu-toggle" aria-label="Menu" type="button">Menu</button>
  <a class="desktop-cta" href="/book">Book Now</a>
  <a class="mobile-cta" href="/book">Book Now</a>
</body>
</html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(req.url === "/book" ? "<!doctype html><title>Book</title><h1>Book</h1>" : html);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const targetUrl = `http://127.0.0.1:${address.port}/`;

  const result = await validateConversionPaths({
    targetUrl,
    keyPages: [{ url: targetUrl, role: "conversion" }],
    options: {
      allowLiveBrowser: true,
      screenshots: true,
      mobile: true,
      settleTimeoutMs: 50,
      gotoTimeoutMs: 10_000,
    },
  });

  assert.equal(result.status, PATH_VALIDATION_STATUS.PASS);
  assert.equal(result.pages.length, 1);

  const page = result.pages[0];
  assert.equal(page.status, PATH_VALIDATION_STATUS.PASS);

  for (const viewport of ["desktop", "mobile"]) {
    const checks = page.checks[viewport];
    assert.equal(checks.cta.found, true, `${viewport}: CTA found`);
    assert.equal(checks.cta.visible, true, `${viewport}: selected CTA is visible`);
    assert.equal(checks.cta.interactable, true, `${viewport}: selected CTA is enabled`);
    assert.equal(checks.cta.obstructed, false, `${viewport}: selected CTA is unobstructed`);
    assert.match(checks.cta.target, /\/book$/, `${viewport}: CTA target resolves to governed local destination`);
    assert.equal(checks.menu.usable, true, `${viewport}: navigation is usable`);
    assert.equal(checks.destination.checked, true, `${viewport}: same-origin destination checked`);
    assert.equal(checks.destination.loaded, true, `${viewport}: destination loads`);
  }

  process.stdout.write("PRYSM RESPONSIVE CONVERSION ACCEPTANCE: PASS — desktop+mobile real Chromium\n");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
