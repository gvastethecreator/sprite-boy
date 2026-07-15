/** Production Chrome performance/accessibility budget gate. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runBrowserSmoke } from "./studio-browser-smoke.mjs";

export const BROWSER_BUDGET_SCHEMA_VERSION = 1;

function freezeThresholds(value) {
  return Object.freeze({
    idleRafRequests: value.idleRafRequests,
    inputToPaintP95Ms: value.inputToPaintP95Ms,
    longTaskMaxMs: value.longTaskMaxMs,
    unlabeledInteractiveCount: value.unlabeledInteractiveCount,
    mainLandmarkCount: value.mainLandmarkCount,
  });
}

export const BROWSER_BUDGET_THRESHOLDS = Object.freeze({
  ratchet: freezeThresholds({
    idleRafRequests: 1,
    inputToPaintP95Ms: 50,
    longTaskMaxMs: 100,
    unlabeledInteractiveCount: 0,
    mainLandmarkCount: 1,
  }),
  release: freezeThresholds({
    idleRafRequests: 1,
    inputToPaintP95Ms: 50,
    longTaskMaxMs: 100,
    unlabeledInteractiveCount: 0,
    mainLandmarkCount: 1,
  }),
});

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function percentile95(samples) {
  const sorted = samples.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

const EXPECTED_WORKSPACE_TRANSITIONS = Object.freeze(
  Array.from({ length: 4 }, (_, run) => ["compose", "animate", "collision", "export", "slice"]
    .map((workspaceId) => Object.freeze({ run, workspaceId })))
    .flat(),
);

function hasExpectedWorkspaceTransitions(transitions) {
  return Array.isArray(transitions) && transitions.length === EXPECTED_WORKSPACE_TRANSITIONS.length &&
    transitions.every((transition, index) => {
      const expected = EXPECTED_WORKSPACE_TRANSITIONS[index];
      return transition?.run === expected.run && transition.workspaceId === expected.workspaceId &&
        transition.finalHash === `#/studio/${expected.workspaceId}` && transition.active === true &&
        transition.contentActive === true;
    });
}

export function evaluateBrowserBudgets(smokeResult, profile = "ratchet") {
  if (!Object.hasOwn(BROWSER_BUDGET_THRESHOLDS, profile)) throw new TypeError("Unknown browser budget profile.");
  const evidence = smokeResult?.budgets;
  const accessibility = evidence?.accessibility;
  const interactionSamples = evidence?.interactionSamplesMs;
  const unlabeledRoles = accessibility?.unlabeledRoles;
  const unlabeledRoleTotal = unlabeledRoles && typeof unlabeledRoles === "object"
    ? Object.values(unlabeledRoles).reduce(
      (sum, count) => Number.isSafeInteger(count) && count >= 0 ? sum + count : Number.NaN,
      0,
    )
    : Number.NaN;
  if (
    smokeResult?.status !== "pass" || !evidence || !accessibility ||
    !Number.isSafeInteger(evidence.idleWindowMs) || evidence.idleWindowMs < 5_000 ||
    !Number.isSafeInteger(evidence.idleRafRequests) || evidence.idleRafRequests < 0 ||
    !Array.isArray(interactionSamples) || interactionSamples.length !== EXPECTED_WORKSPACE_TRANSITIONS.length ||
    interactionSamples.some((value) => !finiteNonNegative(value)) ||
    !hasExpectedWorkspaceTransitions(evidence.interactionTransitions) ||
    !finiteNonNegative(evidence.inputToPaintP95Ms) ||
    evidence.inputToPaintP95Ms !== percentile95(interactionSamples) ||
    evidence.longTaskObserverAvailable !== true ||
    !Number.isSafeInteger(evidence.longTaskCount) || evidence.longTaskCount < 0 ||
    !finiteNonNegative(evidence.longTaskMaxMs) ||
    !finiteNonNegative(evidence.longTaskTotalMs) ||
    (evidence.longTaskCount === 0 && (evidence.longTaskMaxMs !== 0 || evidence.longTaskTotalMs !== 0)) ||
    (evidence.longTaskCount > 0 && (
      evidence.longTaskMaxMs <= 0 || evidence.longTaskTotalMs < evidence.longTaskMaxMs
    )) ||
    !finiteNonNegative(evidence.performanceMetrics?.JSHeapUsedSize) ||
    !Number.isSafeInteger(accessibility.exposedNodeCount) || accessibility.exposedNodeCount <= 0 ||
    !Number.isSafeInteger(accessibility.interactiveNodeCount) || accessibility.interactiveNodeCount < 0 ||
    !Number.isSafeInteger(accessibility.unlabeledInteractiveCount) || accessibility.unlabeledInteractiveCount < 0 ||
    !Number.isSafeInteger(accessibility.mainLandmarkCount) || accessibility.mainLandmarkCount < 0 ||
    accessibility.interactiveNodeCount > accessibility.exposedNodeCount ||
    accessibility.unlabeledInteractiveCount > accessibility.interactiveNodeCount ||
    accessibility.mainLandmarkCount > accessibility.exposedNodeCount ||
    unlabeledRoleTotal !== accessibility.unlabeledInteractiveCount ||
    evidence.finalRoute !== "#/studio/slice"
  ) {
    throw new TypeError("Browser budget evidence is invalid.");
  }
  const thresholds = BROWSER_BUDGET_THRESHOLDS[profile];
  const exceeded = [];
  if (evidence.idleRafRequests > thresholds.idleRafRequests) exceeded.push("idleRafRequests");
  if (evidence.inputToPaintP95Ms > thresholds.inputToPaintP95Ms) exceeded.push("inputToPaintP95Ms");
  if (evidence.longTaskMaxMs > thresholds.longTaskMaxMs) exceeded.push("longTaskMaxMs");
  if (accessibility.unlabeledInteractiveCount > thresholds.unlabeledInteractiveCount) {
    exceeded.push("unlabeledInteractiveCount");
  }
  if (accessibility.mainLandmarkCount !== thresholds.mainLandmarkCount) {
    exceeded.push("mainLandmarkCount");
  }
  return Object.freeze({
    schemaVersion: BROWSER_BUDGET_SCHEMA_VERSION,
    check: "browser-budgets",
    profile,
    status: exceeded.length === 0 ? "pass" : "fail",
    metrics: Object.freeze({
      idleWindowMs: evidence.idleWindowMs,
      idleRafRequests: evidence.idleRafRequests,
      inputToPaintP95Ms: evidence.inputToPaintP95Ms,
      interactionSampleCount: interactionSamples.length,
      verifiedTransitionCount: evidence.interactionTransitions.length,
      longTaskCount: evidence.longTaskCount,
      longTaskMaxMs: evidence.longTaskMaxMs,
      longTaskTotalMs: evidence.longTaskTotalMs,
      jsHeapUsedBytes: evidence.performanceMetrics.JSHeapUsedSize ?? null,
      exposedAxNodes: accessibility.exposedNodeCount,
      interactiveAxNodes: accessibility.interactiveNodeCount,
      unlabeledInteractiveCount: accessibility.unlabeledInteractiveCount,
      unlabeledRoles: Object.freeze({ ...unlabeledRoles }),
      mainLandmarkCount: accessibility.mainLandmarkCount,
    }),
    thresholds,
    exceeded: Object.freeze(exceeded),
  });
}

export function parseBrowserBudgetArguments(args) {
  if (args.length === 0) return Object.freeze({ profile: "ratchet" });
  if (
    args.length !== 2 || args[0] !== "--profile" ||
    !Object.hasOwn(BROWSER_BUDGET_THRESHOLDS, args[1])
  ) {
    throw new TypeError("Browser budget profile is invalid.");
  }
  return Object.freeze({ profile: args[1] });
}

export async function runBrowserBudgetCheck(profile = "ratchet", options = {}) {
  try {
    const smokeResult = await (options.runBrowserSmoke ?? runBrowserSmoke)({
      ...options,
      collectBudgets: true,
    });
    return evaluateBrowserBudgets(smokeResult, profile);
  } catch {
    return Object.freeze({
      schemaVersion: BROWSER_BUDGET_SCHEMA_VERSION,
      check: "browser-budgets",
      profile,
      status: "fail",
      reason: "browser-budget-unavailable",
    });
  }
}

export async function runBrowserBudgetCli(args = process.argv.slice(2), io = {}, dependencies = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let parsed;
  try {
    parsed = parseBrowserBudgetArguments(args);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : "Invalid browser budget arguments."}\n`);
    return 2;
  }
  const result = await runBrowserBudgetCheck(parsed.profile, dependencies);
  stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "pass" ? 0 : 1;
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = await runBrowserBudgetCli();
