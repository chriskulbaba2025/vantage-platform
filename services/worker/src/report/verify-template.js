import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableHash } from "../utils.js";

const EXPECTED_CSS_HASH = "3d1a86d9e20900b6b76de3e703311af5cdb7b8b1bef67f66ed869b101a0a9c92";
const EXPECTED_SCRIPT_HASH = "35d219d6a1d37627c6d1ac96dc4641923c2c8ee9db1316a293e04afcc535142b";
const here = dirname(fileURLToPath(import.meta.url));
const template = await readFile(resolve(here, "karen-leslie-template.html"), "utf8");
const style = (template.match(/<style>[\s\S]*?<\/style>/)?.[0] || "").replace(/\r\n/g, "\n");
const script = (template.match(/<script>[\s\S]*?<\/script>/)?.[0] || "").replace(/\r\n/g, "\n");
if (stableHash(style) !== EXPECTED_CSS_HASH) throw new Error("Locked Karen Leslie report CSS changed");
if (stableHash(script) !== EXPECTED_SCRIPT_HASH) throw new Error("Locked Karen Leslie report JavaScript changed");
for (const token of ["{{TITLE}}", "{{HEADER}}", "{{PRINT_BUTTON}}", "{{SECTIONS}}", "{{FOOTER}}"]) {
  if (!template.includes(token)) throw new Error(`Missing template token ${token}`);
}
console.log(JSON.stringify({ status: "PASS", cssHash: EXPECTED_CSS_HASH, scriptHash: EXPECTED_SCRIPT_HASH }, null, 2));
