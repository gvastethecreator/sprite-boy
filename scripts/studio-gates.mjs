/**
 * Stable, shell-free quality gate runner.
 *
 * Usage:
 *   bun scripts/studio-gates.mjs --list
 *   bun scripts/studio-gates.mjs --gate contract --dry-run
 *   bun scripts/studio-gates.mjs --gate all
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const GATE_SCHEMA_VERSION = 1;

function processStep(id, label, args, timeoutMs) {
  return Object.freeze({
    id,
    label,
    command: "bun",
    args: Object.freeze([...args]),
    timeoutMs,
  });
}

const STEPS = Object.freeze({
  typecheck: processStep("typecheck", "TypeScript typecheck", ["x", "tsc", "--noEmit"], 120_000),
  lint: processStep(
    "lint",
    "Repository lint (zero warnings)",
    ["x", "oxlint", ".", "--deny-warnings"],
    120_000,
  ),
  unit: processStep("unit", "Unit and component tests", [
    "x", "vitest", "run",
    "tests/components", "tests/hooks", "tests/scripts", "tests/types", "tests/utils",
    "--pool=threads", "--maxWorkers=3",
  ], 300_000),
  contract: processStep("contract", "Contract tests", [
    "x", "vitest", "run", "tests/contract", "--pool=threads", "--maxWorkers=3",
  ], 300_000),
  integration: processStep("integration", "Integration tests", [
    "x", "vitest", "run", "tests/integration", "--pool=threads", "--maxWorkers=2",
  ], 180_000),
  coverage: processStep(
    "coverage",
    "Canonical coverage ratchet",
    ["scripts/studio-quality-policy.mjs", "coverage", "--profile", "ratchet"],
    360_000,
  ),
  fixtures: processStep(
    "fixtures",
    "Fixture and golden retention",
    ["scripts/studio-quality-policy.mjs", "fixtures"],
    30_000,
  ),
  build: processStep("build", "Production build", ["x", "vite", "build"], 180_000),
  bundle: processStep(
    "bundle-budget",
    "Initial JavaScript bundle budget",
    ["scripts/studio-quality-policy.mjs", "bundle", "--profile", "ratchet"],
    30_000,
  ),
  browserBudget: processStep(
    "browser-budget",
    "Production performance and accessibility budgets",
    ["scripts/studio-browser-budget.mjs", "--profile", "ratchet"],
    120_000,
  ),
  persistenceBrowser: processStep(
    "persistence-browser",
    "Durable reload and portable package browser journey",
    ["scripts/studio-persistence-browser.mjs"],
    180_000,
  ),
  browser: processStep(
    "browser-smoke",
    "Production Chrome smoke",
    ["scripts/studio-browser-smoke.mjs"],
    90_000,
  ),
});

function gate(id, label, steps) {
  return Object.freeze({ id, label, steps: Object.freeze([...steps]) });
}

export const STUDIO_GATE_MANIFEST = Object.freeze({
  schemaVersion: GATE_SCHEMA_VERSION,
  gates: Object.freeze({
    typecheck: gate("typecheck", "Typecheck", [STEPS.typecheck]),
    lint: gate("lint", "Lint", [STEPS.lint]),
    unit: gate("unit", "Unit tests", [STEPS.unit]),
    contract: gate("contract", "Contract tests", [STEPS.contract]),
    integration: gate("integration", "Integration tests", [STEPS.integration]),
    coverage: gate("coverage", "Canonical coverage ratchet", [STEPS.coverage]),
    fixtures: gate("fixtures", "Fixture and golden retention", [STEPS.fixtures]),
    budgets: gate("budgets", "Bundle, performance and accessibility budgets", [
      STEPS.build,
      STEPS.bundle,
      STEPS.browserBudget,
    ]),
    persistence: gate("persistence", "Durable persistence browser journey", [STEPS.persistenceBrowser]),
    build: gate("build", "Production build", [STEPS.build]),
    e2e: gate("e2e", "Production browser smoke", [STEPS.build, STEPS.browser]),
    all: gate("all", "Complete local gate", [
      STEPS.typecheck,
      STEPS.lint,
      STEPS.unit,
      STEPS.contract,
      STEPS.integration,
      STEPS.coverage,
      STEPS.fixtures,
      STEPS.persistenceBrowser,
      STEPS.build,
      STEPS.bundle,
      STEPS.browserBudget,
    ]),
  }),
});

export function parseGateArguments(args) {
  const parsed = { gateId: null, list: false, dryRun: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--list") {
      if (seen.has(argument)) throw new TypeError("Duplicate studio gate argument: --list.");
      seen.add(argument);
      parsed.list = true;
    } else if (argument === "--dry-run") {
      if (seen.has(argument)) throw new TypeError("Duplicate studio gate argument: --dry-run.");
      seen.add(argument);
      parsed.dryRun = true;
    } else if (argument === "--gate") {
      if (seen.has(argument)) throw new TypeError("Duplicate studio gate argument: --gate.");
      seen.add(argument);
      const gateId = args[index + 1];
      if (!gateId || gateId.startsWith("--")) throw new TypeError("--gate requires a gate ID.");
      parsed.gateId = gateId;
      index += 1;
    } else {
      throw new TypeError(`Unknown studio gate argument: ${argument}`);
    }
  }
  if (parsed.list && parsed.gateId !== null) {
    throw new TypeError("--list cannot be combined with --gate.");
  }
  if (parsed.list && parsed.dryRun) {
    throw new TypeError("--dry-run requires --gate and cannot be combined with --list.");
  }
  if (!parsed.list && parsed.gateId === null) {
    throw new TypeError("A studio gate ID is required.");
  }
  return Object.freeze(parsed);
}

export function resolveGatePlan(gateId) {
  if (typeof gateId !== "string" || !Object.hasOwn(STUDIO_GATE_MANIFEST.gates, gateId)) {
    throw new TypeError("Unknown studio gate ID.");
  }
  return STUDIO_GATE_MANIFEST.gates[gateId];
}

export function serializeGate(gateDefinition) {
  return {
    schemaVersion: GATE_SCHEMA_VERSION,
    id: gateDefinition.id,
    label: gateDefinition.label,
    steps: gateDefinition.steps.map((step) => ({
      id: step.id,
      label: step.label,
      command: step.command,
      args: [...step.args],
      timeoutMs: step.timeoutMs,
    })),
  };
}

export function runGatePlan(gateDefinition, options = {}) {
  const spawn = options.spawnSync ?? spawnSync;
  const cwd = resolve(options.cwd ?? process.cwd());
  const stdio = options.stdio ?? "inherit";
  const completed = [];

  for (const step of gateDefinition.steps) {
    const result = spawn(step.command, [...step.args], {
      cwd,
      env: process.env,
      shell: false,
      stdio,
      timeout: step.timeoutMs,
      windowsHide: true,
    });
    if (result.error) {
      const timedOut = result.error.code === "ETIMEDOUT";
      return Object.freeze({
        status: "failed",
        gateId: gateDefinition.id,
        completed: Object.freeze([...completed]),
        failedStep: step.id,
        reason: timedOut ? "timeout" : "spawn-failure",
        exitCode: 1,
      });
    }
    if (result.status !== 0) {
      return Object.freeze({
        status: "failed",
        gateId: gateDefinition.id,
        completed: Object.freeze([...completed]),
        failedStep: step.id,
        reason: "non-zero-exit",
        exitCode: typeof result.status === "number" && result.status > 0 ? result.status : 1,
      });
    }
    completed.push(step.id);
  }

  return Object.freeze({
    status: "passed",
    gateId: gateDefinition.id,
    completed: Object.freeze([...completed]),
    failedStep: null,
    reason: null,
    exitCode: 0,
  });
}

function listPayload() {
  return {
    schemaVersion: GATE_SCHEMA_VERSION,
    gates: Object.values(STUDIO_GATE_MANIFEST.gates).map(({ id, label, steps }) => ({
      id,
      label,
      steps: steps.map((step) => step.id),
    })),
  };
}

export function runGateCli(args = process.argv.slice(2), io = {}, dependencies = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let parsed;
  try {
    parsed = parseGateArguments(args);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : "Invalid studio gate arguments."}\n`);
    return 2;
  }

  if (parsed.list) {
    stdout.write(`${JSON.stringify(listPayload())}\n`);
    return 0;
  }

  let gateDefinition;
  try {
    gateDefinition = resolveGatePlan(parsed.gateId);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : "Unknown studio gate ID."}\n`);
    return 2;
  }
  if (parsed.dryRun) {
    stdout.write(`${JSON.stringify(serializeGate(gateDefinition))}\n`);
    return 0;
  }

  const result = runGatePlan(gateDefinition, dependencies);
  stdout.write(`${JSON.stringify(result)}\n`);
  return result.exitCode;
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = runGateCli();
