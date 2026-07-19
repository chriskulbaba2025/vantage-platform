import { escapeHtml } from "../utils.js";

export const e = escapeHtml;
export const severityClass = (value) => value === "High" || value === "H" ? "severity-high" : value === "Medium" || value === "M" ? "severity-medium" : "severity-low";
export const scoreClass = (value) => value >= 70 ? "score-green" : value >= 40 ? "score-amber" : "score-red";
export const fmtSec = (ms) => Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "Unavailable";
export const fmt = (value, fallback = "Unavailable") => value === null || value === undefined || value === "" ? fallback : e(value);

export function table(headers, rows) {
  return `<table><tr>${headers.map((h) => `<th>${e(h)}</th>`).join("")}</tr>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>`;
}

export function scoreCard(value, label, numeric = true) {
  const cls = numeric ? scoreClass(Number(value)) : (String(value).toLowerCase().includes("strong") ? "score-green" : String(value).toLowerCase().includes("moderate") ? "score-amber" : "score-red");
  return `<div class="score-card ${cls}"><div class="value">${e(value)}</div><div class="label">${e(label)}</div></div>`;
}

export function section(id, num, title, body) {
  return `<section id="${id}"><h2><span class="sec-num">${num} /</span> ${e(title)}</h2>${body}</section>`;
}
