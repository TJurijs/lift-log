import fs from "node:fs";

export function loadPerformanceBudgets(filePath = "performance/budgets.json") {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function check(results, name, actual, maximum, required = true) {
  const available = Number.isFinite(actual);
  const passed = !required && !available ? true : available && actual <= maximum;
  results.push({ name, actual: available ? actual : null, maximum, required, passed });
}

export function evaluateBundleMetrics(metrics, budgets) {
  const checks = [];
  for (const group of ["initialJs", "largestAsyncJs", "totalJs", "css"]) {
    check(checks, `bundle.${group}.rawBytes`, metrics[group]?.rawBytes, budgets.bundle[group].rawBytesMax);
    check(checks, `bundle.${group}.gzipBytes`, metrics[group]?.gzipBytes, budgets.bundle[group].gzipBytesMax);
  }
  return { passed: checks.every(({ passed }) => passed), checks, violations: checks.filter(({ passed }) => !passed) };
}

export function evaluateRuntimeReport(report, budgets) {
  const checks = [];
  const personas = report.personas ?? [];
  if (!personas.length) checks.push({ name: "runtime.personas", actual: 0, minimum: 1, required: true, passed: false });
  for (const persona of personas) {
    const prefix = `runtime.${persona.persona ?? "persona"}.bootstrap`;
    check(checks, `${prefix}.dataApiRequests`, persona.bootstrap?.dataApi?.requestCount, budgets.runtime.bootstrap.dataApiRequestsMax);
    check(checks, `${prefix}.readyMs`, persona.bootstrap?.readyMs, budgets.runtime.bootstrap.readyMsMax);
    check(checks, `${prefix}.domRows`, persona.bootstrap?.dom?.rowCount, budgets.runtime.bootstrap.domRowsMax);
    const screens = persona.screens ?? [];
    if (!screens.length) checks.push({ name: `runtime.${persona.persona ?? "persona"}.screens`, actual: 0, minimum: 1, required: true, passed: false });
    for (const screen of screens) {
      const kind = screen.kind === "detail" ? "detail" : "navigation";
      const screenBudget = budgets.runtime[kind];
      const screenPrefix = `runtime.${persona.persona ?? "persona"}.${screen.id ?? "screen"}`;
      check(checks, `${screenPrefix}.dataApiRequestsP95`, screen.dataApiRequests?.p95, screenBudget.dataApiRequestsP95Max);
      check(checks, `${screenPrefix}.readyMsP95`, screen.readyMs?.p95, screenBudget.readyMsP95Max);
      check(checks, `${screenPrefix}.domRows`, screen.rowCount?.max, screenBudget.domRowsMax);
      if (kind === "navigation") {
        check(checks, `${screenPrefix}.longTaskCountP95`, screen.longTaskCount?.p95, screenBudget.longTaskCountP95Max, false);
        check(checks, `${screenPrefix}.longTaskTotalMsP95`, screen.longTaskTotalMs?.p95, screenBudget.longTaskTotalMsP95Max, false);
        check(checks, `${screenPrefix}.interactionLatencyP75`, screen.interactionLatencyMs?.p75, screenBudget.interactionLatencyP75Max, screenBudget.interactionLatencyRequired);
      }
    }
  }
  return { passed: checks.every(({ passed }) => passed), checks, violations: checks.filter(({ passed }) => !passed) };
}
