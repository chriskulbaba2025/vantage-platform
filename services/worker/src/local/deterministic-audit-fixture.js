/**
 * Deterministic LOCAL TEST DATA for the localhost audit path.
 *
 * This is consumed only when server.js explicitly enables
 * PRYSM_LOCAL_DETERMINISTIC_AUDIT under the local persistence guard.
 */
export const LOCAL_DETERMINISTIC_ONPAGE_FIXTURES = Object.freeze({
  taskPost: { taskId: "local-deterministic-fixture-001" },
  pollTask: { status: "ready" },
  summary: {
    crawl_status: { pages_crawled: 1, max_crawl_pages: 10 },
    domain_info: { checks: {} },
    page_metrics: { links_internal: 4, checks: {} },
  },
  pages: {
    total_count: 1,
    items: [{
      url: "https://local.test/",
      status_code: 200,
      meta: {
        title: "Local Test Website",
        description: "A deterministic local PRYSM test website.",
        h1: ["Local Test Website"],
        h2: ["Services", "Contact"],
        word_count: 300,
        content_language: "en",
        generator: "Local Test Fixture",
        structured_data_types: ["ProfessionalService", "WebSite"],
        plain_text: "Local test services, client testimonials, case studies, FAQ, transparent pricing, privacy policy, and a clear contact path.",
      },
      microdata: { types: [{ type: "Service", name: "Local test service" }] },
      checks: {},
      resources: {
        buttons: [{ text: "Book Now", url: "https://local.test/book" }],
        forms: [{ action: "/submit", inputs_count: 2 }],
      },
    }],
  },
  links: { items: [], total_count: 0 },
  duplicate_tags: { items: [] },
  duplicate_content: { items: [] },
  microdata: { items: [{ type: "Service" }] },
  content_parsing: [{
    url: "https://local.test/",
    result: {
      main_content: [{ text: "Local test services, client testimonials, case studies, FAQ, transparent pricing, privacy policy, and a clear contact path." }],
      secondary_content: [],
      plain_text_word_count: 24,
    },
  }],
});
