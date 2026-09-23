const DIMENSIONS = 1536;
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function classifyError(message, category, statusCode = null) {
  const error = new Error(message);
  error.category = category;
  if (statusCode !== null) error.statusCode = statusCode;
  return error;
}

function validateEndpoint(raw, allowedHostsRaw) {
  const endpoint = String(raw || DEFAULT_ENDPOINT).trim();
  let url;
  try { url = new URL(endpoint); } catch { throw classifyError("Embedding endpoint is invalid", "configuration"); }
  const allowedHosts = new Set(String(allowedHostsRaw || "api.openai.com").split(",").map((host) => host.trim()).filter(Boolean));
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) throw classifyError("Embedding endpoint is not an approved HTTPS provider", "configuration");
  return url.href;
}

export function createOpenAIEmbeddingAdapter({ env = process.env, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const apiKey = String(env.PRYSM_EMBEDDING_API_KEY || env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;
  if (typeof fetchImpl !== "function") throw classifyError("Embedding fetch implementation is unavailable", "configuration");
  const endpoint = validateEndpoint(env.PRYSM_EMBEDDING_ENDPOINT || DEFAULT_ENDPOINT, env.PRYSM_EMBEDDING_ALLOWED_HOSTS);
  const modelVersion = String(env.PRYSM_EMBEDDING_MODEL || DEFAULT_MODEL).trim();
  const timeoutMs = positiveInteger(env.PRYSM_EMBEDDING_TIMEOUT_MS, 15000);
  const maxAttempts = Math.min(2, positiveInteger(env.PRYSM_EMBEDDING_MAX_ATTEMPTS, 2));

  async function embed(input) {
    const value = String(input || "").trim();
    if (!value) throw classifyError("Embedding input is empty", "input");
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ input: value, model: modelVersion, dimensions: DIMENSIONS, encoding_format: "float" }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          lastError = classifyError(`Embedding provider returned ${response.status}`, retryable ? "provider_retryable" : "provider", response.status);
          if (!retryable || attempt === maxAttempts) throw lastError;
        } else {
          const body = await response.json();
          const vector = body?.data?.[0]?.embedding;
          if (!Array.isArray(vector) || vector.length !== DIMENSIONS || vector.some((item) => !Number.isFinite(item))) throw classifyError("Embedding provider returned an invalid vector", "provider_payload");
          return vector;
        }
      } catch (error) {
        lastError = error?.category ? error : classifyError(error?.name === "AbortError" ? "Embedding provider timed out" : "Embedding provider request failed", error?.name === "AbortError" ? "timeout" : "network");
        if (attempt === maxAttempts || !["provider_retryable", "timeout", "network"].includes(lastError.category)) throw lastError;
      } finally {
        clearTimeout(timer);
      }
      await sleep(Math.min(500 * attempt, 1000));
    }
    throw lastError || classifyError("Embedding provider unavailable", "unavailable");
  }

  return Object.freeze({ embed, modelVersion, dimensions: DIMENSIONS, provider: "openai-compatible" });
}

export { DIMENSIONS as EMBEDDING_DIMENSIONS };
