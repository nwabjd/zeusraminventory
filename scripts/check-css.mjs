#!/usr/bin/env node
/**
 * Regression guard for the shared form-control CSS in dist/assets/*.css.
 *
 * Guards two globally-shared facts that the whole app depends on:
 *
 * 1. `.input` controls must keep a paint-safe CONTENT box. Every control shares
 *    `box-sizing: border-box`, so `height` must be >= vertical padding + borders
 *    + a positive content height (>= line-height 16.5px for the 11px font).
 *    If the content box collapses to <= 0, Chromium clips the painted value of
 *    every <select> to zero height and dropdown selections appear blank even
 *    though the value commits (the ZEUS "dropdown selections do not display"
 *    regression, caused by height:9px).
 *
 * 2. `select.input` keeps exactly ONE custom chevron (background-repeat:
 *    no-repeat); a missing no-repeat re-introduces the "⌄⌄⌄⌄⌄" tiling bug.
 *
 * Usage: node scripts/check-css.mjs   (after `npm run build`)
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
let cssFile;
try {
  cssFile = readdirSync(dir).find((f) => f.endsWith(".css"));
} catch {
  console.error("FAIL: dist/assets not found - run `npm run build` first.");
  process.exit(1);
}
const css = readFileSync(join(dir, cssFile), "utf8");

const errors = [];
const pick = (text, name) => {
  const re = new RegExp(name + "\\s*:\\s*([^;}]+)", "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
};
const num = (v) => (v == null ? NaN : parseFloat(v));
function paddings(rule) {
  const pb = pick(rule, "padding-bottom");
  if (pb != null) return { top: num(pick(rule, "padding-top")), bottom: num(pb) };
  const p = pick(rule, "padding");
  if (p == null) return { top: 0, bottom: 0 };
  const parts = p.split(/\s+/).map(num);
  if (parts.length === 4) return { top: parts[0], bottom: parts[2] };
  if (parts.length === 3) return { top: parts[0], bottom: parts[2] };
  if (parts.length === 2) return { top: parts[0], bottom: parts[0] };
  return { top: parts[0] || 0, bottom: parts[0] || 0 };
}

// Sanity: the corrupted height value must never come back.
if (/\bheight\s*:\s*9px\b/.test(css)) {
  errors.push(`height:9px found in ${cssFile} - re-introduces blank selects`);
}

// Locate the .input rule.
const start = css.indexOf(".input{");
if (start < 0) {
  errors.push(".input rule not found in built CSS");
} else {
  const end = css.indexOf("}", start);
  const rule = css.slice(start, end);
  const height = num(pick(rule, "height"));
  const pad = paddings(rule);
  const content = height - pad.top - pad.bottom - 2; // 2px borders
  if (!(content >= 15)) {
    errors.push(`.input content box = ${content.toFixed(1)}px (< 15px) - select values will be clipped`);
  }
}

// select.input keeps one chevron.
const ssel = css.indexOf("select.input{");
if (ssel >= 0) {
  const end = css.indexOf("}", ssel);
  const rule = css.slice(ssel, end);
  if (!/background-repeat\s*:\s*no-repeat/i.test(rule)) {
    errors.push("select.input lost background-repeat:no-repeat - chevrons will tile");
  }
  if ((rule.match(/background-image/g) || []).length !== 1) {
    errors.push("select.input should declare exactly one background-image");
  }
}

if (errors.length) {
  console.error("CSS CONTRACT VIOLATION:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`CSS OK: ${cssFile} (${(css.length / 1024).toFixed(1)} kB). Input content box >= 15px; single chevron intact.`);