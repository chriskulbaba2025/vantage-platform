# Prysm Report Immutability Contract

**Version:** 1.0.0  
**Report version:** `prysm-report-design-v1.0.0`  
**Status:** Mandatory build gate

---

# 1. Purpose

This contract protects the current approved client-facing report while the underlying pipeline is rebuilt.

The report is a locked product asset.

Pipeline changes must adapt their output to the report. The report must not be adapted to pipeline changes.

---

# 2. Locked assets

The design lock includes:

- every approved HTML page;
- shared CSS;
- page-specific CSS;
- logos;
- icons;
- images;
- charts;
- tables;
- font references;
- navigation;
- headers;
- footers;
- CTA;
- print rules;
- viewer behaviour;
- page filenames;
- report index;
- download and print controls.

No provider, scoring, database, n8n or LLM PR may modify these assets.

---

# 3. Locked report structure

The exact current accepted report is the final authority.

The baseline includes these required sections:

1. Executive scorecard
2. Priority fixes
3. Conversion path architecture
4. Conversion readiness map
5. Topical map and qualified content opportunities
6. Competitor benchmark
7. Trust and E-E-A-T readiness
8. CMS and platform constraints
9. Technical SEO hygiene
10. Heading and semantic structure
11. Schema and entity clarity
12. Performance
13. Internal-link opportunities
14. Evidence appendix
15. Deferred and unavailable analysis

The golden master must record the exact current filenames, titles, order and navigation links.

---

# 4. Golden-master package

Before the rebuild begins, create:

```text
report-golden-master/
├── manifest.json
├── html/
├── css/
├── assets/
├── screenshots/
├── print-screenshots/
├── dom-signatures/
└── checksums.sha256
```

`manifest.json` records:

- report design version;
- accepted source run ID;
- page count;
- filename and title of every page;
- HTML checksum;
- screenshot checksum;
- CSS checksum;
- asset-manifest checksum;
- approval user;
- approval time.

---

# 5. Protected renderer boundary

The renderer accepts a versioned `ReportViewModel`.

It must not accept:

- raw DataForSEO responses;
- raw PageSpeed responses;
- raw GA4 or GSC responses;
- arbitrary n8n HTML;
- arbitrary CSS;
- arbitrary section arrays;
- arbitrary page names.

The renderer owns:

- page creation;
- page order;
- element hierarchy;
- component selection;
- CSS;
- navigation;
- print controls;
- pagination.

---

# 6. n8n and LLM restrictions

n8n and the LLM may return text only inside fixed fields.

They may not return:

- HTML;
- CSS;
- Markdown for direct rendering;
- page layouts;
- page breaks;
- section names;
- page order;
- score values;
- finding IDs;
- new evidence;
- new URLs;
- new recommendations.

Every returned ID must already exist in the canonical report-content package.

---

# 7. Content-length governance

Each narrative field receives deterministic limits based on the accepted report.

For each field record:

- maximum characters;
- maximum words;
- maximum paragraphs;
- maximum list items;
- whether truncation is permitted;
- whether one repair is permitted;
- overflow behaviour.

The renderer never changes layout to accommodate excessive model output.

---

# 8. Regression levels

## 8.1 Structural regression

Fail on changes to:

- page count;
- filename;
- section order;
- required element;
- navigation;
- DOM hierarchy;
- CSS class contract;
- print button;
- report metadata.

## 8.2 Style regression

Fail on changes to:

- CSS checksum;
- font size;
- margin;
- padding;
- colour;
- width;
- height;
- display mode;
- page-break rule;
- print rule.

## 8.3 Visual regression

Render every page and print view.

Compare against approved screenshots.

Dynamic text regions may be masked only when element geometry remains compared and the mask cannot hide layout drift.

---

# 9. Change governance

A report-design change must:

1. use a report-design branch;
2. increment the report-design version;
3. include before-and-after screenshots;
4. explain the reason;
5. pass accessibility review;
6. receive Principal Auditor approval;
7. create a new golden master.

Pipeline PRs may not update the golden master.

---

# 10. Report release gate

A build fails when:

- a locked file changes unexpectedly;
- a required page is missing;
- page order changes;
- a section is added or removed;
- CSS changes;
- visual comparison exceeds threshold;
- print output changes;
- n8n returns HTML or CSS;
- the renderer receives unvalidated content;
- a draft report becomes client-accessible.
