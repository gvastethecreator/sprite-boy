import { describe, expect, it, vi } from "vitest";
import { summarizeAccessibilityTree } from "../../scripts/studio-browser-smoke.mjs";
import {
  BROWSER_BUDGET_THRESHOLDS,
  evaluateBrowserBudgets,
  parseBrowserBudgetArguments,
  runBrowserBudgetCheck,
} from "../../scripts/studio-browser-budget.mjs";

function passingSmoke() {
  const workspaceIds = ["compose", "animate", "collision", "export", "slice"];
  return {
    status: "pass",
    budgets: {
      idleWindowMs: 5_000,
      idleRafRequests: 0,
      interactionSamplesMs: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
      interactionTransitions: Array.from({ length: 4 }, (_, run) => workspaceIds.map((workspaceId) => ({
        run,
        workspaceId,
        finalHash: `#/studio/${workspaceId}`,
        active: true,
        contentActive: true,
      }))).flat(),
      inputToPaintP95Ms: 28,
      longTaskCount: 1,
      longTaskMaxMs: 55,
      longTaskTotalMs: 55,
      longTaskObserverAvailable: true,
      finalRoute: "#/studio/slice",
      performanceMetrics: { JSHeapUsedSize: 12_345 },
      accessibility: {
        exposedNodeCount: 50,
        interactiveNodeCount: 10,
        unlabeledInteractiveCount: 0,
        unlabeledRoles: {},
        mainLandmarkCount: 1,
      },
    },
  };
}

describe("browser performance and accessibility budgets", () => {
  it("freezes documented release thresholds and accepts bounded evidence", () => {
    expect(BROWSER_BUDGET_THRESHOLDS.release).toEqual({
      idleRafRequests: 1,
      inputToPaintP95Ms: 50,
      longTaskMaxMs: 100,
      unlabeledInteractiveCount: 0,
      mainLandmarkCount: 1,
    });
    expect(evaluateBrowserBudgets(passingSmoke(), "release")).toMatchObject({
      status: "pass",
      exceeded: [],
      metrics: {
        idleRafRequests: 0,
        inputToPaintP95Ms: 28,
        verifiedTransitionCount: 20,
        unlabeledInteractiveCount: 0,
      },
    });
  });

  it("fails every exceeded performance/a11y dimension and invalid evidence", () => {
    const failing = passingSmoke();
    failing.budgets.idleRafRequests = 2;
    failing.budgets.interactionSamplesMs[18] = 51;
    failing.budgets.interactionSamplesMs[19] = 52;
    failing.budgets.inputToPaintP95Ms = 51;
    failing.budgets.longTaskMaxMs = 101;
    failing.budgets.longTaskTotalMs = 101;
    failing.budgets.accessibility.unlabeledInteractiveCount = 1;
    failing.budgets.accessibility.unlabeledRoles = { button: 1 };
    failing.budgets.accessibility.mainLandmarkCount = 0;
    expect(evaluateBrowserBudgets(failing, "ratchet")).toMatchObject({
      status: "fail",
      exceeded: [
        "idleRafRequests",
        "inputToPaintP95Ms",
        "longTaskMaxMs",
        "unlabeledInteractiveCount",
        "mainLandmarkCount",
      ],
    });
    expect(() => evaluateBrowserBudgets({ status: "pass" }, "ratchet")).toThrow(/invalid/);
    const inconsistent = passingSmoke();
    inconsistent.budgets.inputToPaintP95Ms = 10;
    expect(() => evaluateBrowserBudgets(inconsistent, "ratchet")).toThrow(/invalid/);
    const unsupported = passingSmoke();
    unsupported.budgets.longTaskObserverAvailable = false;
    expect(() => evaluateBrowserBudgets(unsupported, "ratchet")).toThrow(/invalid/);
    const impossibleLongTasks = passingSmoke();
    impossibleLongTasks.budgets.longTaskCount = 0;
    expect(() => evaluateBrowserBudgets(impossibleLongTasks, "ratchet")).toThrow(/invalid/);
    const inconsistentAx = passingSmoke();
    inconsistentAx.budgets.accessibility.unlabeledRoles = { button: 1 };
    expect(() => evaluateBrowserBudgets(inconsistentAx, "ratchet")).toThrow(/invalid/);
    const incompleteTransitions = passingSmoke();
    incompleteTransitions.budgets.interactionTransitions[0].active = false;
    expect(() => evaluateBrowserBudgets(incompleteTransitions, "ratchet")).toThrow(/invalid/);
    const duplicateMain = passingSmoke();
    duplicateMain.budgets.accessibility.mainLandmarkCount = 2;
    expect(evaluateBrowserBudgets(duplicateMain, "ratchet")).toMatchObject({
      status: "fail",
      exceeded: ["mainLandmarkCount"],
    });
  });

  it("summarizes the AX tree without retaining labels and contains runtime failures", async () => {
    expect(summarizeAccessibilityTree([
      { ignored: false, role: { value: "main" }, name: { value: "Studio" } },
      { ignored: false, role: { value: "button" }, name: { value: "" } },
      { ignored: false, role: { value: "link" }, name: { value: "Slice" } },
      { ignored: false, role: { value: "option" }, name: { value: "" } },
      {
        ignored: false,
        role: { value: "generic" },
        name: { value: "" },
        properties: [{ name: "focusable", value: { value: true } }],
      },
      { ignored: true, role: { value: "button" }, name: { value: "" } },
    ])).toEqual({
      exposedNodeCount: 5,
      interactiveNodeCount: 4,
      unlabeledInteractiveCount: 3,
      unlabeledRoles: { button: 1, option: 1, generic: 1 },
      mainLandmarkCount: 1,
    });

    const failed = await runBrowserBudgetCheck("ratchet", {
      runBrowserSmoke: vi.fn().mockRejectedValue(new Error("private browser path")),
    });
    expect(failed).toEqual({
      schemaVersion: 1,
      check: "browser-budgets",
      profile: "ratchet",
      status: "fail",
      reason: "browser-budget-unavailable",
    });
  });

  it("parses only allowlisted profiles", () => {
    expect(parseBrowserBudgetArguments([])).toEqual({ profile: "ratchet" });
    expect(parseBrowserBudgetArguments(["--profile", "release"])).toEqual({ profile: "release" });
    expect(() => parseBrowserBudgetArguments(["--profile", "private"])).toThrow(/invalid/);
  });
});
