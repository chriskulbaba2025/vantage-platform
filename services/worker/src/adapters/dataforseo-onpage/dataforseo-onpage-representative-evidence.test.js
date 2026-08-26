import test from "node:test";
import assert from "node:assert/strict";

import {
  crawlWithDataforseo,
} from "./dataforseo-onpage-adapter.js";

function rawPage(url, title) {
  return {
    url,
    status_code: 200,
    meta: {
      title,
      description: `${title} description`,
      htags: { h1: [title] },
      content: { plain_text_word_count: 320 },
    },
    checks: { from_sitemap: true },
  };
}

function parsedResult(text) {
  return {
    items: [{
      page_content: {
        main_topic: [{
          primary_content: [{ text }],
          secondary_content: [],
        }],
        secondary_topic: [],
      },
    }],
  };
}

function jsonResponse(value) {
  return new Response(
    JSON.stringify(value),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

test(
  "Track B real adapter discovers sitemap footprint and submits representative On-Page policy",
  async () => {
    process.env.DATAFORSEO_LOGIN = "test-user";
    process.env.DATAFORSEO_PASSWORD = "test-pass";

    const submitted = [];

    const locationUrls = Array.from(
      { length: 12 },
      (_, index) =>
        `https://example.com/locations/city-${index + 1}`,
    );

    const sitemapXml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      [
        "https://example.com/",
        "https://example.com/contact",
        "https://example.com/pricing",
        ...locationUrls,
      ]
        .map((url) => `<url><loc>${url}</loc></url>`)
        .join("") +
      `</urlset>`;

    const fetchImpl = async (url, init = {}) => {
      const href = String(url);

      if (href === "https://example.com/robots.txt") {
        return new Response(
          "Sitemap: https://example.com/sitemap.xml\n",
          {
            status: 200,
            headers: {
              "content-type": "text/plain",
            },
          },
        );
      }

      if (
        href === "https://example.com/sitemap.xml" ||
        href === "https://example.com/sitemap_index.xml"
      ) {
        return new Response(
          sitemapXml,
          {
            status: 200,
            headers: {
              "content-type": "application/xml",
            },
          },
        );
      }

      if (href.includes("/on_page/task_post")) {
        const body = JSON.parse(init.body);
        submitted.push(body[0]);

        return jsonResponse({
          status_code: 20000,
          tasks: [{
            id: "track-b-task",
            status_code: 20100,
            status_message: "Task Created.",
            result: null,
          }],
        });
      }

      if (href.includes("/on_page/summary/")) {
        return jsonResponse({
          status_code: 20000,
          tasks: [{
            id: "track-b-task",
            status_code: 20000,
            result: [{
              crawl_progress: "finished",
              crawl_status: {
                crawl_stop_reason: "empty_queue",
                max_crawl_pages: 500,
                pages_crawled: 1,
                pages_in_queue: 0,
              },
              domain_info: {
                checks: {},
                extended_crawl_status: "no_errors",
              },
              page_metrics: {
                links_internal: 0,
                checks: {},
              },
            }],
          }],
        });
      }

      if (href.includes("/on_page/pages")) {
        return jsonResponse({
          status_code: 20000,
          tasks: [{
            status_code: 20000,
            result: [{
              items: [
                rawPage(
                  "https://example.com/",
                  "Home",
                ),
              ],
              total_count: 1,
            }],
          }],
        });
      }

      if (href.includes("/on_page/links")) {
        return jsonResponse({
          status_code: 20000,
          tasks: [{
            status_code: 20000,
            result: [{
              items: [],
              total_count: 0,
            }],
          }],
        });
      }

      if (href.includes("api.dataforseo.com")) {
        return jsonResponse({
          status_code: 20000,
          tasks: [{
            status_code: 20000,
            result: [{ items: [] }],
          }],
        });
      }

      return new Response(
        "Not Found",
        { status: 404 },
      );
    };

    try {
      const result = await crawlWithDataforseo(
        "https://example.com/",
        {
          enableContentParsing: false,
          sitemapFetchImpl: fetchImpl,
          clientOptions: {
            mode: "live",
            fetchImpl,
          },
        },
      );

      assert.equal(
        submitted.length,
        1,
        "one paid task was submitted",
      );

      assert.equal(
        submitted[0].max_crawl_pages,
        250,
      );

      assert.equal(
        submitted[0].respect_sitemap,
        true,
      );

      assert.equal(
        submitted[0].return_despite_timeout,
        true,
      );

      assert.ok(
        submitted[0].priority_urls.length <= 20,
      );

      assert.ok(
        submitted[0].priority_urls.some(
          (url) => url.includes("/locations/"),
        ),
        "priority_urls includes a structural-family representative",
      );

      assert.ok(
        ["AVAILABLE", "PARTIAL"].includes(
          result.siteFootprint.status,
        ),
      );

      assert.equal(
        result.programmaticSeo.status,
        "LIKELY",
      );
    } finally {
      delete process.env.DATAFORSEO_LOGIN;
      delete process.env.DATAFORSEO_PASSWORD;
    }
  },
);

test(
  "Track B deep parsing merges business pages with material cluster representatives",
  async () => {
    const root = "https://example.com";
    const contact = "https://example.com/contact";
    const pa =
      "https://example.com/locations/pennsylvania";
    const oh =
      "https://example.com/locations/ohio";
    const va =
      "https://example.com/locations/virginia";

    const siteFootprint = {
      status: "AVAILABLE",
      incomplete: false,
      discoveredUrlCount: 35,
      retainedUrlCount: 35,
      sitemapDocumentCount: 2,
      capped: false,
      clusterCount: 1,
      priorityUrls: [
        root,
        contact,
        pa,
        oh,
        va,
      ],
      coverage: {
        usableSitemap: true,
        complete: true,
        parsedDocumentCount: 2,
        failedDocumentCount: 0,
      },
      limitations: [],
      clusters: [{
        id: "location-family",
        pattern: "/locations/{segment}",
        discoveredUrlCount: 30,
        representativeUrls: [
          pa,
          oh,
          va,
        ],
        requiresRepresentativeAssessment: true,
        reasonCodes: [
          "VARIABLE_SIBLING_FAMILY",
          "LARGE_REPEATED_FAMILY",
        ],
      }],
    };

    const pages = [
      rawPage(root, "Executive Coaching"),
      rawPage(
        contact,
        "Book an Executive Coaching Consultation",
      ),
      rawPage(
        pa,
        "Executive Coaching Pennsylvania",
      ),
      rawPage(
        oh,
        "Executive Coaching Ohio",
      ),
      rawPage(
        va,
        "Executive Coaching Virginia",
      ),
    ];

    const parsed = [
      [
        root,
        "Executive coaching for senior leaders with structured programs, credentials, testimonials, case studies, and consultation options. ".repeat(30),
      ],
      [
        contact,
        "Book an executive coaching consultation. Our team explains the process, services, credentials, client results, and next steps. ".repeat(30),
      ],
      [
        pa,
        "Executive coaching for Pennsylvania leaders. Our certified team provides leadership programs, testimonials, case studies, and consultation options. ".repeat(30),
      ],
      [
        oh,
        "Executive coaching for Ohio leaders. Our certified team provides leadership programs, testimonials, case studies, and consultation options. ".repeat(30),
      ],
      [
        va,
        "Executive coaching for Virginia leaders. Our certified team provides leadership programs, testimonials, case studies, and consultation options. ".repeat(30),
      ],
    ].map(([url, text]) => ({
      url,
      result: parsedResult(text),
    }));

    const result = await crawlWithDataforseo(
      root,
      {
        siteFootprint,
        businessServices: [
          "Executive Coaching",
        ],
        contentParsingPageLimit: 20,
        clientOptions: {
          mode: "fixture",
          fixtures: {
            taskPost: {
              taskId: "fixture-track-b",
            },
            pollTask: {
              status: "ready",
            },
            summary: {
              crawl_status: {
                crawl_stop_reason: "empty_queue",
                max_crawl_pages: 500,
                pages_crawled: pages.length,
                pages_in_queue: 0,
              },
              domain_info: {
                checks: {},
                extended_crawl_status: "no_errors",
              },
              page_metrics: {
                links_internal: 0,
                checks: {},
              },
            },
            pages: {
              items: pages,
              total_count: pages.length,
            },
            links: {
              items: [],
              total_count: 0,
            },
            duplicateTags: {
              items: [],
            },
            duplicate_content: {
              items: [],
            },
            microdata: {
              items: [],
            },
            contentParsing: parsed,
            redirectChains: [],
            nonIndexable: {
              items: [],
              total_count: 0,
            },
            resources: {},
          },
        },
      },
    );

    assert.equal(
      result.siteFootprint.status,
      "AVAILABLE",
    );

    assert.equal(
      result.programmaticSeo.status,
      "LIKELY",
    );

    const parsedUrls = new Set(
      result.contentParsing.map(
        (item) => item.url,
      ),
    );

    assert.ok(parsedUrls.has(contact));
    assert.ok(parsedUrls.has(pa));
    assert.ok(parsedUrls.has(oh));
    assert.ok(parsedUrls.has(va));

    assert.ok(
      result.acquisition.contentParsing.requested <= 20,
    );
  },
);

test(
  "Track B unavailable sitemap footprint stays explicit",
  async () => {
    const result = await crawlWithDataforseo(
      "https://example.com",
      {
        siteFootprint: {
          status: "UNAVAILABLE",
          incomplete: true,
          discoveredUrlCount: 0,
          retainedUrlCount: 0,
          sitemapDocumentCount: 0,
          capped: false,
          clusterCount: 0,
          priorityUrls: [
            "https://example.com",
          ],
          coverage: {
            usableSitemap: false,
            complete: false,
            parsedDocumentCount: 0,
            failedDocumentCount: 1,
          },
          limitations: [
            "No usable sitemap was available.",
          ],
          clusters: [],
        },
        enableContentParsing: false,
        clientOptions: {
          mode: "fixture",
          fixtures: {
            taskPost: {
              taskId: "fixture-no-sitemap",
            },
            pollTask: {
              status: "ready",
            },
            summary: {
              crawl_status: {
                crawl_stop_reason: "empty_queue",
                max_crawl_pages: 500,
                pages_crawled: 1,
                pages_in_queue: 0,
              },
              domain_info: {
                checks: {},
                extended_crawl_status: "no_errors",
              },
              page_metrics: {
                links_internal: 0,
                checks: {},
              },
            },
            pages: {
              items: [
                rawPage(
                  "https://example.com",
                  "Home",
                ),
              ],
              total_count: 1,
            },
            links: {
              items: [],
              total_count: 0,
            },
            duplicateTags: {
              items: [],
            },
            duplicate_content: {
              items: [],
            },
            microdata: {
              items: [],
            },
            redirectChains: [],
            nonIndexable: {
              items: [],
              total_count: 0,
            },
            resources: {},
          },
        },
      },
    );

    assert.equal(
      result.siteFootprint.status,
      "UNAVAILABLE",
    );

    assert.equal(
      result.programmaticSeo.status,
      "INSUFFICIENT_EVIDENCE",
    );

    assert.notEqual(
      result.programmaticSeo.status,
      "NOT_DETECTED",
    );
  },
);