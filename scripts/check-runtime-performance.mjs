import fs from "node:fs";
import process from "node:process";

import { evaluateRuntimeReport, loadPerformanceBudgets } from "./lib/performance-budgets.mjs";

let reportPath = "artifacts/performance/runtime-local.json";
let mode = "report";
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith("--report=")) reportPath = argument.slice(9);
  else if (argument.startsWith("--mode=")) mode = argument.slice(7);
  else throw new Error(`Unknown option: ${argument}`);
}
if (!new Set(["report", "gate"]).has(mode)) throw new Error("Mode must be report or gate.");
const evaluation = evaluateRuntimeReport(JSON.parse(fs.readFileSync(reportPath, "utf8")), loadPerformanceBudgets());
process.stdout.write(`${JSON.stringify(evaluation, null, 2)}\n`);
if (mode === "gate" && !evaluation.passed) process.exitCode = 1;
