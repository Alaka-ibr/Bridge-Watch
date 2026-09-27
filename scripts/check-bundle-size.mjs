#!/usr/bin/env node
/**
 * Bundle size check for CI (#1341).
 *
 * - Walks `frontend/dist` and sums raw + gzip sizes of emitted assets.
 * - Compares against `frontend/.bundle-size-baseline.json`.
 * - Warning threshold: +500KB raw over baseline (exit 0, sets warning flag).
 * - Failure threshold: +1MB raw over baseline (exit 1).
 * - Emits GitHub Actions outputs + step-summary friendly markdown when
 *   `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` are present.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs [--dist=frontend/dist] [--baseline=frontend/.bundle-size-baseline.json]
 *                                       [--warn-kb=500] [--fail-kb=1024] [--update-baseline]
 */
import { createGzip } from "zlib";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { pipeline } from "stream/promises";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(=(.*))?$/);
    return m ? [m[1], m[3] ?? "true"] : [a, "true"];
  })
);

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const distDir = path.resolve(args.dist ?? path.join(ROOT, "frontend/dist"));
const baselinePath = path.resolve(args.baseline ?? path.join(ROOT, "frontend/.bundle-size-baseline.json"));
const WARN_BYTES = Number(args["warn-kb"] ?? 500) * 1024;
const FAIL_BYTES = Number(args["fail-kb"] ?? 1024) * 1024;

async function gzipSize(file) {
  const src = createReadStream(file);
  let bytes = 0;
  const counter = createGzip();
  counter.on("data", (c) => (bytes += c.length));
  await pipeline(src, counter);
  return bytes;
}

async function walk(dir, out = []) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function fmt(bytes) {
  if (Math.abs(bytes) >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  const files = (await walk(distDir)).filter((f) => /\.(js|css|html|wasm)$/.test(f));
  let total = 0;
  let gzipTotal = 0;
  const details = [];
  for (const f of files) {
    const stat = await fs.stat(f);
    const gz = await gzipSize(f).catch(() => 0);
    total += stat.size;
    gzipTotal += gz;
    details.push({ file: path.relative(distDir, f), bytes: stat.size, gzipBytes: gz });
  }
  details.sort((a, b) => b.bytes - a.bytes);

  let baseline = { totalBytes: 0, gzipBytes: 0 };
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  } catch {
    // No baseline yet — treat current as baseline (first run).
  }
  const baseTotal = Number(baseline.totalBytes ?? 0);
  const baseGzip = Number(baseline.gzipBytes ?? 0);
  const diff = total - baseTotal;
  const gzipDiff = gzipTotal - baseGzip;

  const warn = diff > WARN_BYTES && diff <= FAIL_BYTES;
  const fail = diff > FAIL_BYTES;

  const lines = [
    `### Frontend bundle size`,
    ``,
    `| Metric | Current | Baseline | Diff |`,
    `|---|---|---|---|`,
    `| Raw | ${fmt(total)} | ${fmt(baseTotal)} | ${diff >= 0 ? "+" : ""}${fmt(diff)} |`,
    `| Gzip | ${fmt(gzipTotal)} | ${fmt(baseGzip)} | ${gzipDiff >= 0 ? "+" : ""}${fmt(gzipDiff)} |`,
    ``,
    `Warning threshold: +${fmt(WARN_BYTES)} · Failure threshold: +${fmt(FAIL_BYTES)}`,
    fail
      ? `❌ Bundle grew by ${fmt(diff)} — exceeds failure threshold.`
      : warn
        ? `⚠️ Bundle grew by ${fmt(diff)} — exceeds warning threshold.`
        : `✅ Bundle size within budget.`,
    ``,
    `<details><summary>Largest assets</summary>`,
    ``,
    `| Asset | Raw | Gzip |`,
    `|---|---|---|`,
    ...details.slice(0, 15).map((d) => `| \`${d.file}\` | ${fmt(d.bytes)} | ${fmt(d.gzipBytes)} |`),
    `</details>`,
  ];
  const markdown = lines.join("\n");

  const out = {
    totalBytes: total,
    gzipBytes: gzipTotal,
    baselineBytes: baseTotal,
    diffBytes: diff,
    gzipDiffBytes: gzipDiff,
    warn: warn || fail,
    fail,
  };

  // Console output for logs.
  console.log(`bundle: raw=${total} gzip=${gzipTotal} baseline=${baseTotal} diff=${diff}`);
  console.log(markdown);

  try {
    await fs.writeFile(process.env.BUNDLE_SIZE_JSON ?? "/tmp/bundle-size.json", JSON.stringify(out, null, 2));
    await fs.writeFile("/tmp/bundle-size.md", markdown);
  } catch { /* ignore */ }

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `bundle_total_bytes=${total}\nbundle_gzip_bytes=${gzipTotal}\nbundle_diff_bytes=${diff}\nbundle_warn=${warn || fail}\nbundle_fail=${fail}\n`
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  }

  if (args["update-baseline"] === "true") {
    await fs.writeFile(
      baselinePath,
      JSON.stringify({ generatedAt: new Date().toISOString(), totalBytes: total, gzipBytes: gzipTotal, files: details }, null, 2) + "\n"
    );
    console.log(`Baseline updated at ${baselinePath}`);
  }

  if (fail) {
    console.error(`::error::Frontend bundle increased by ${fmt(diff)} (failure threshold +${fmt(FAIL_BYTES)})`);
    process.exit(1);
  } else if (warn) {
    console.log(`::warning::Frontend bundle increased by ${fmt(diff)} (warning threshold +${fmt(WARN_BYTES)})`);
  }
}

main();
