import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

import {
  SCALE_SCENARIOS,
  createScaleFixtureManifest,
  generateScenarioRecords,
} from "./lib/scale-fixture.mjs";

function parseArgs(argumentsList) {
  const options = { scenarios: Object.keys(SCALE_SCENARIOS), format: "summary", output: null };
  for (const argument of argumentsList) {
    if (argument.startsWith("--scenario=")) {
      const value = argument.slice("--scenario=".length);
      options.scenarios = value === "all" ? Object.keys(SCALE_SCENARIOS) : value.split(",");
    } else if (argument.startsWith("--format=")) {
      options.format = argument.slice("--format=".length);
    } else if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.scenarios.length || options.scenarios.some((name) => !SCALE_SCENARIOS[name])) {
    throw new Error(`Scenario must be one or more of: ${Object.keys(SCALE_SCENARIOS).join(", ")}`);
  }
  if (!new Set(["summary", "ndjson"]).has(options.format)) {
    throw new Error("Format must be summary or ndjson");
  }
  return options;
}

async function writeLine(stream, value) {
  if (stream.write(`${JSON.stringify(value)}\n`)) return;
  await new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.output) mkdirSync(dirname(options.output), { recursive: true });
  const stream = options.output ? createWriteStream(options.output, { encoding: "utf8" }) : process.stdout;
  if (options.format === "summary") {
    await writeLine(stream, createScaleFixtureManifest(options.scenarios));
  } else {
    await writeLine(stream, {
      type: "manifest",
      value: createScaleFixtureManifest(options.scenarios),
    });
    for (const scenario of options.scenarios) {
      for (const record of generateScenarioRecords(scenario)) await writeLine(stream, record);
    }
  }
  if (options.output) await new Promise((resolve, reject) => stream.end(resolve).once("error", reject));
}

main().catch((error) => {
  process.stderr.write(`Scale fixture generation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
