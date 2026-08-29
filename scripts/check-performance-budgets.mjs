import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

import { evaluateBundleMetrics, loadPerformanceBudgets } from "./lib/performance-budgets.mjs";

function options(argumentsList) {
  const result = { dist: "dist", mode: "report", output: null };
  for (const argument of argumentsList) {
    if (argument.startsWith("--dist=")) result.dist = argument.slice(7);
    else if (argument.startsWith("--mode=")) result.mode = argument.slice(7);
    else if (argument.startsWith("--output=")) result.output = argument.slice(9);
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!new Set(["report", "gate"]).has(result.mode)) throw new Error("Mode must be report or gate.");
  return result;
}

function sum(files) {
  return files.reduce((total, file) => {
    const body = fs.readFileSync(file);
    total.rawBytes += body.byteLength;
    total.gzipBytes += gzipSync(body, { level: 9 }).byteLength;
    return total;
  }, { rawBytes: 0, gzipBytes: 0 });
}

function largest(files) {
  return files.reduce(
    (largestFile, file) => {
      const body = fs.readFileSync(file);
      const candidate = {
        file: path.basename(file),
        rawBytes: body.byteLength,
        gzipBytes: gzipSync(body, { level: 9 }).byteLength,
      };
      return candidate.rawBytes > largestFile.rawBytes ? candidate : largestFile;
    },
    { file: null, rawBytes: 0, gzipBytes: 0 },
  );
}

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(resolved) : [resolved];
  });
}

function measure(dist) {
  const index = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const all = filesUnder(dist);
  const js = all.filter((file) => file.endsWith(".js"));
  const css = all.filter((file) => file.endsWith(".css"));
  const entryNames = [...index.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gu)]
    .map((match) => path.basename(match[1]));
  const entry = js.filter((file) => entryNames.includes(path.basename(file)));
  const asyncFiles = js.filter((file) => !entry.includes(file));
  const releaseSha = index.match(/<meta\s+name=["']liftlog-release["']\s+content=["']([^"']+)["']/u)?.[1] ?? null;
  return {
    releaseSha,
    metrics: {
      initialJs: sum(entry),
      largestAsyncJs: largest(asyncFiles),
      // Aggregate async bytes remain useful for reporting, but splitting a
      // feature must not fail a route-load gate merely by creating more chunks.
      asyncJs: sum(asyncFiles),
      totalJs: sum(js),
      css: sum(css),
    },
  };
}

try {
  const parsed = options(process.argv.slice(2));
  const { metrics, releaseSha } = measure(parsed.dist);
  const evaluation = evaluateBundleMetrics(metrics, loadPerformanceBudgets());
  const releaseCheck = {
    name: "release.sha",
    actual: releaseSha,
    required: true,
    passed: typeof releaseSha === "string" && /^(?:[0-9a-f]{7,40}|local|development|test)$/u.test(releaseSha),
  };
  evaluation.checks.push(releaseCheck);
  if (!releaseCheck.passed) evaluation.violations.push(releaseCheck);
  evaluation.passed = evaluation.violations.length === 0;
  const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), releaseSha, metrics, ...evaluation };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (parsed.output) {
    fs.mkdirSync(path.dirname(parsed.output), { recursive: true });
    fs.writeFileSync(parsed.output, serialized);
  }
  process.stdout.write(serialized);
  if (parsed.mode === "gate" && !evaluation.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Bundle budget check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
