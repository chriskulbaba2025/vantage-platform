import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableHash } from "../utils.js";

const EXPECTED_CSS_HASH = "04f85950237982d04619cd03a9170a19920cbc9b712c4f191711cba3144cdc7d";
const EXPECTED_SCRIPT_HASH = "54826b80ba2b60a95730136b24ca3b1992772dbab37cc7aa6168f92dd2cef6c5";
const here = dirname(fileURLToPath(import.meta.url));
const template = await readFile(resolve(here, "karen-leslie-template.html"), "utf8");
const style = (template.match(/<style>[\s\S]*?<\/style>/)?.[0] || "").replace(/\r\n/g, "\n");
const script = (template.match(/<script>[\s\S]*?<\/script>/)?.[0] || "").replace(/\r\n/g, "\n");
if (stableHash(style) !== EXPECTED_CSS_HASH) throw new Error("Locked Karen Leslie report CSS changed");
if (stableHash(script) !== EXPECTED_SCRIPT_HASH) throw new Error("Locked Karen Leslie report JavaScript changed");
for (const token of ["{{TITLE}}", "{{HEADER}}", "{{SECTIONS}}", "{{FOOTER}}"]) {
  if (!template.includes(token)) throw new Error(`Missing template token ${token}`);
}
console.log(JSON.stringify({ status: "PASS", cssHash: EXPECTED_CSS_HASH, scriptHash: EXPECTED_SCRIPT_HASH }, null, 2));
