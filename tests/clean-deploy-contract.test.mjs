import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("Vercel repository defaults cannot route Preview to production", () => {
  const config = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
  assert.equal(Object.hasOwn(config, "env"), false);
  assert.doesNotMatch(readFileSync(resolve(root, "vercel.json"), "utf8"), /vantage-platform-production\.up\.railway\.app/);
});

test("Railway contract uses repository-root Dockerfile context and direct worker start", () => {
  const railway = readFileSync(resolve(root, "railway.toml"), "utf8");
  const dockerfile = readFileSync(resolve(root, "services/worker/Dockerfile"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve(root, "services/worker/package.json"), "utf8"));
  assert.match(railway, /builder\s*=\s*"DOCKERFILE"/);
  assert.match(railway, /dockerfilePath\s*=\s*"services\/worker\/Dockerfile"/);
  assert.match(railway, /startCommand\s*=\s*"node src\/server\.js"/);
  assert.match(dockerfile, /COPY services\/worker\/package\*\.json/);
  assert.match(dockerfile, /COPY services\/worker\//);
  assert.equal(packageJson.name, "vantage-worker");
  assert.equal(packageJson.scripts.start, "node src/server.js");
});
