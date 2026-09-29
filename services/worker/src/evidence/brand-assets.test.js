import test from "node:test";
import assert from "node:assert/strict";
import { collectBrandAssetCandidates, normalizeBrandIdentity, verifyBrandAsset } from "./brand-assets.js";

test("brand collection discovers header, structured-data, favicon, and non-promoted hero candidates", () => {
  const html = `<header><a href="/"><img src="/img/acme-logo.svg" alt="Acme logo"></a></header><link rel="icon" href="/favicon.ico"><script type="application/ld+json">{"@type":"Organization","name":"Acme","logo":"/schema-logo.png"}</script><meta property="og:image" content="/hero.jpg">`;
  const candidates = collectBrandAssetCandidates(html, "https://acme.example/");
  assert.ok(candidates.some((item) => item.sourceType === "header-logo"));
  assert.ok(candidates.some((item) => item.sourceType === "structured-data"));
  assert.ok(candidates.some((item) => item.sourceType === "favicon"));
  assert.ok(candidates.some((item) => item.sourceType === "og-image" && item.likelyLogo === false));
  const identity = normalizeBrandIdentity({ candidates, canonicalDomain: "acme.example", businessName: "Acme" });
  assert.equal(identity.logo.sourceType, "header-logo");
  assert.equal(identity.logo.firstParty, true);
  assert.equal(identity.logo.verified, true);
});

test("off-domain, conflicting, and hero-image candidates fail closed", () => {
  const offDomain = verifyBrandAsset({ url: "https://other.example/logo.svg", sourceUrl: "https://acme.example/", sourceType: "header-logo", likelyLogo: true }, { canonicalDomain: "acme.example", businessName: "Acme" });
  const conflict = verifyBrandAsset({ url: "https://acme.example/other.svg", sourceUrl: "https://acme.example/", sourceType: "header-logo", identityText: "Other Company", likelyLogo: true }, { canonicalDomain: "acme.example", businessName: "Acme" });
  const hero = verifyBrandAsset({ url: "https://acme.example/hero.jpg", sourceUrl: "https://acme.example/", sourceType: "og-image", likelyLogo: false }, { canonicalDomain: "acme.example", businessName: "Acme" });
  assert.equal(offDomain.verified, false);
  assert.equal(conflict.verified, false);
  assert.equal(hero.verified, false);
});

test("favicon-only and no-logo sites retain a valid governed state", () => {
  const favicon = normalizeBrandIdentity({ candidates: [{ url: "https://small.example/favicon.ico", sourceUrl: "https://small.example/", sourceType: "favicon", likelyLogo: true }], canonicalDomain: "small.example", businessName: "Small" });
  const none = normalizeBrandIdentity({ candidates: [], canonicalDomain: "none.example", businessName: "No Logo" });
  assert.equal(favicon.logo.sourceType, "favicon");
  assert.equal(favicon.logo.verified, true);
  assert.equal(none.logo, null);
  assert.equal(none.verificationStatus, "UNAVAILABLE");
});

test("brand provenance survives the persisted JSON contract", () => {
  const identity = normalizeBrandIdentity({ candidates: [{ url: "https://acme.example/logo.png", sourceUrl: "https://acme.example/", sourceType: "header-logo", assetType: "PNG", likelyLogo: true }], canonicalDomain: "acme.example", businessName: "Acme" });
  const roundTrip = JSON.parse(JSON.stringify(identity));
  assert.equal(roundTrip.logo.sourceUrl, "https://acme.example/");
  assert.equal(roundTrip.logo.sourceType, "header-logo");
  assert.equal(roundTrip.logo.firstParty, true);
  assert.equal(roundTrip.logo.verified, true);
});
