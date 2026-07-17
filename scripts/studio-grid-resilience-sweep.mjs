/** G8-03 repeated production browser sweep for console, cleanup and layout leaks. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runGridCommitBrowserGate } from "./studio-grid-commit-browser.mjs";
import { runGridExportBrowserGate } from "./studio-grid-export-browser.mjs";
import { runIrregularBrowserGate } from "./studio-irregular-browser.mjs";

const OUTPUT = "artifacts/quality/GRID/2026-07-16/g8-03-resilience-sweep.json";

const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function retryGate(label, operation, attempts = 3) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      failures.push({ attempt, message: error instanceof Error ? error.message : String(error) });
      if (attempt < attempts) await delay(500);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${JSON.stringify(failures)}`);
}

export async function runGridResilienceSweep(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const iterations = options.iterations ?? 3;
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 5) {
    throw new TypeError("Resilience sweep iterations must be an integer between 1 and 5.");
  }
  const runs = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const suffix = `g8-03-sweep-${iteration}`;
    const commit = await retryGate(`${suffix}-commit`, () => runGridCommitBrowserGate({
      cwd,
      screenshotPath: `artifacts/quality/GRID/2026-07-16/${suffix}-commit.png`,
    }));
    const exportRun = await retryGate(`${suffix}-export`, () => runGridExportBrowserGate({
      cwd,
      screenshotPath: `artifacts/quality/GRID/2026-07-16/${suffix}-export.png`,
    }));
    const irregular = await retryGate(`${suffix}-irregular`, () => runIrregularBrowserGate({
      cwd,
      screenshotPath: `artifacts/quality/GRID/2026-07-16/${suffix}-irregular.png`,
    }));
    runs.push({
      iteration,
      checks: [commit.check, exportRun.check, irregular.check],
      statuses: [commit.status, exportRun.status, irregular.status],
      errors: [commit.errors, exportRun.errors, irregular.errors],
      layouts: [commit.layout, exportRun.layout, irregular.layout],
      accessibility: [commit.accessibility, exportRun.accessibility, irregular.accessibility],
    });
  }
  const passed = runs.every((run) => run.statuses.every((status) => status === "pass")
    && run.errors.every((errors) => Object.values(errors).every((value) => value === 0))
    && run.layouts.every((layout) => layout.horizontalOverflow === false && layout.verticalOverflow === false)
    && run.accessibility.every((accessibility) => accessibility.unlabeledInteractiveCount === 0));
  const evidence = {
    schemaVersion: 1,
    check: "studio-grid-resilience-sweep",
    status: passed ? "pass" : "fail",
    iterations,
    runs,
    assertion: "all G6/G7/S1 browser journeys repeat without runtime errors, unlabeled interactives or overflow",
  };
  const outputPath = resolve(cwd, options.outputPath ?? OUTPUT);
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  if (!passed) throw new Error(`G8-03 resilience sweep failed: ${JSON.stringify(evidence)}`);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runGridResilienceSweep())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, check: "studio-grid-resilience-sweep", status: "fail", message: error instanceof Error ? error.message : "unknown" })}\n`);
    process.exitCode = 1;
  }
}
