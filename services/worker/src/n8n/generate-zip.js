/**
 * Prysm Netlify ZIP Generator
 *
 * Packages a static report directory into a Netlify-ready ZIP archive.
 *
 * Usage:
 *   node src/n8n/generate-zip.js <reportDir> [zipOutputPath]
 *
 * Default output: <reportDir>/../vantage-report.zip
 */

import { spawnSync } from "child_process";
import { existsSync, statSync, readdirSync } from "fs";
import { resolve } from "path";

function main() {
  const reportDir = process.argv[2];
  if (!reportDir || !existsSync(reportDir)) {
    console.error("Usage: node src/n8n/generate-zip.js <reportDir> [zipOutput]");
    console.error("  reportDir must exist and contain index.html");
    process.exit(1);
  }

  const indexPath = resolve(reportDir, "index.html");
  if (!existsSync(indexPath)) {
    console.error(`reportDir must contain index.html: ${reportDir}`);
    process.exit(1);
  }

  const zipPath = process.argv[3] || resolve(reportDir, "..", "vantage-report.zip");

  // Try system zip first (Linux/Railway/macOS)
  const zipResult = spawnSync("zip", ["-r", zipPath, "."], { cwd: reportDir, stdio: "pipe" });
  if (zipResult.status !== 0) {
    // Fallback: PowerShell Compress-Archive on Windows
    const psResult = spawnSync("powershell", [
      "-Command",
      `Compress-Archive -Path '${reportDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ], { stdio: "pipe" });
    if (psResult.status !== 0) {
      console.error("ZIP generation failed. Ensure zip or PowerShell is available.");
      console.error(psResult.stderr?.toString() || "");
      process.exit(1);
    }
  }

  if (!existsSync(zipPath)) {
    console.error("ZIP file was not created");
    process.exit(1);
  }

  const size = statSync(zipPath).size;
  console.log(`ZIP created: ${zipPath} (${(size / 1024).toFixed(1)} KB)`);
}

main();
