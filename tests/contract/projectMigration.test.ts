import { describe, expect, it, vi } from "vitest";
import {
  ProjectMigrationError,
  ProjectMigrator,
  isProjectMigrationError,
} from "../../core/persistence";
import type {
  ProjectMigrationIssue,
  ProjectMigrationStep,
} from "../../core/persistence";

function step(
  id: string,
  fromVersion: number,
  migrate: ProjectMigrationStep<{ trace: string[] }>["migrate"],
): ProjectMigrationStep<{ trace: string[] }> {
  return { id, fromVersion, toVersion: fromVersion + 1, migrate };
}

async function captureError(work: () => unknown): Promise<ProjectMigrationError> {
  try {
    await work();
  } catch (error) {
    expect(isProjectMigrationError(error)).toBe(true);
    return error as ProjectMigrationError;
  }
  throw new Error("Expected ProjectMigrationError.");
}

const changeIssue = Object.freeze({
  code: "RENAMED_FIELD",
  category: "change",
  severity: "info",
  blocking: false,
  path: "$.title",
  message: "Renamed title to name.",
}) satisfies ProjectMigrationIssue;

describe("ProjectMigrator ordered contract (F3-02)", () => {
  it("executes a complete path in order and emits a typed aggregate report", async () => {
    const trace: string[] = [];
    const migrator = new ProjectMigrator([
      step("project-0-to-1", 0, (document, context) => {
        context.trace.push("0→1");
        return {
          status: "completed",
          document: { ...(document as object), name: "Hero" },
          issues: [changeIssue],
        };
      }),
      step("project-1-to-2", 1, (document, context) => {
        context.trace.push("1→2");
        return {
          status: "completed",
          document: { ...(document as object), schemaVersion: 2 },
          issues: [{
            code: "DEFAULT_FPS",
            category: "warning",
            severity: "warning",
            blocking: false,
            path: "$.fps",
            message: "Applied the default frame rate.",
          }],
        };
      }),
    ]);

    const result = await migrator.migrate(
      { title: "Hero", schemaVersion: 0 },
      { sourceVersion: 0, targetVersion: 2, context: { trace } },
    );

    expect(trace).toEqual(["0→1", "1→2"]);
    expect(result.document).toEqual({
      title: "Hero",
      name: "Hero",
      schemaVersion: 2,
    });
    expect(result.report).toEqual({
      status: "migrated",
      sourceVersion: 0,
      targetVersion: 2,
      reachedVersion: 2,
      appliedSteps: [
        { id: "project-0-to-1", fromVersion: 0, toVersion: 1 },
        { id: "project-1-to-2", fromVersion: 1, toVersion: 2 },
      ],
      issues: [changeIssue, {
        code: "DEFAULT_FPS",
        category: "warning",
        severity: "warning",
        blocking: false,
        path: "$.fps",
        message: "Applied the default frame rate.",
      }],
    });
    expect(Object.isFrozen(result.report)).toBe(true);
    expect(Object.isFrozen(result.report.appliedSteps)).toBe(true);
    expect(Object.isFrozen(result.report.issues)).toBe(true);
  });

  it("returns an isolated unchanged document when no migration is required", async () => {
    const input = { schemaVersion: 2, nested: { value: 1 } };
    const result = await new ProjectMigrator([]).migrate(input, {
      sourceVersion: 2,
      targetVersion: 2,
      context: undefined,
    });

    expect(result.document).toEqual(input);
    expect(result.document).not.toBe(input);
    expect((result.document as typeof input).nested).not.toBe(input.nested);
    expect(result.report).toMatchObject({
      status: "unchanged",
      reachedVersion: 2,
      appliedSteps: [],
      issues: [],
    });
  });

  it("preflights the full path before invoking any migration step", async () => {
    const first = vi.fn(() => ({ status: "completed" as const, document: {} }));
    const migrator = new ProjectMigrator([
      { id: "0-to-1", fromVersion: 0, toVersion: 1, migrate: first },
    ]);

    const error = await captureError(() => migrator.migrate({}, {
      sourceVersion: 0,
      targetVersion: 2,
      context: undefined,
    }));

    expect(error).toMatchObject({
      code: "PROJECT_MIGRATION_PATH_MISSING",
      sourceVersion: 0,
      targetVersion: 2,
      reachedVersion: 0,
    });
    expect(first).not.toHaveBeenCalled();
  });

  it("stops on unresolved ambiguity without applying the pending or later step", async () => {
    const later = vi.fn();
    const blockingIssue = {
      code: "AMBIGUOUS_LAYER",
      category: "ambiguity" as const,
      severity: "error" as const,
      blocking: true as const,
      path: "$.layers.legacy",
      message: "Choose the destination layer.",
      entityId: "legacy",
      choices: [
        { id: "foreground", label: "Foreground" },
        { id: "background", label: "Background" },
      ],
    };
    const migrator = new ProjectMigrator([
      step("0-to-1", 0, () => ({
        status: "completed",
        document: { schemaVersion: 1 },
      })),
      step("1-to-2", 1, () => ({ status: "needs-input", issues: [blockingIssue] })),
      step("2-to-3", 2, later),
    ]);

    const result = await migrator.migrate({ schemaVersion: 0 }, {
      sourceVersion: 0,
      targetVersion: 3,
      context: { trace: [] },
    });

    expect(result.document).toEqual({ schemaVersion: 1 });
    expect(result.report).toMatchObject({
      status: "needs-input",
      reachedVersion: 1,
      appliedSteps: [{ id: "0-to-1", fromVersion: 0, toVersion: 1 }],
      pendingStep: { id: "1-to-2", fromVersion: 1, toVersion: 2 },
      issues: [blockingIssue],
    });
    expect(later).not.toHaveBeenCalled();
  });

  it("supports an explicit needs-relink blocker", async () => {
    const issue = {
      code: "ASSET_NOT_EMBEDDED",
      category: "needs-relink" as const,
      severity: "error" as const,
      blocking: true as const,
      path: "$.assets.hero",
      message: "Relink the original source image.",
      sourceRef: "C:\\legacy\\hero.png",
    };
    const migrator = new ProjectMigrator([
      { id: "0-to-1", fromVersion: 0, toVersion: 1, migrate: () => ({
        status: "needs-input",
        issues: [issue],
      }) },
    ]);

    const result = await migrator.migrate({}, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
    });

    expect(result.report.issues).toEqual([issue]);
    expect(result.report.status).toBe("needs-input");
  });

  it("isolates and freezes step inputs while preserving own __proto__ data", async () => {
    const input: Record<string, unknown> = { nested: { value: 1 } };
    Object.defineProperty(input, "__proto__", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { safe: true },
    });
    const migrate = vi.fn((document: unknown) => {
      const data = document as typeof input;
      expect(document).not.toBe(input);
      expect(Object.isFrozen(document)).toBe(true);
      expect(Object.isFrozen(data.nested)).toBe(true);
      expect(() => { (data.nested as { value: number }).value = 2; }).toThrow(TypeError);
      expect(Object.prototype.hasOwnProperty.call(data, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
      return { status: "completed" as const, document: data };
    });

    const result = await new ProjectMigrator([
      { id: "safe", fromVersion: 0, toVersion: 1, migrate },
    ]).migrate(input, { sourceVersion: 0, targetVersion: 1, context: undefined });

    expect(input.nested).toEqual({ value: 1 });
    expect(Object.prototype.hasOwnProperty.call(result.document, "__proto__")).toBe(true);
    expect((Object.prototype as { safe?: unknown }).safe).toBeUndefined();
  });

  it("rejects non-enumerable array elements instead of changing their data semantics", async () => {
    const hidden = ["legacy"];
    Object.defineProperty(hidden, "0", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: "legacy",
    });
    const migrate = vi.fn(() => ({ status: "completed" as const, document: {} }));

    const error = await captureError(() => new ProjectMigrator([
      { id: "safe", fromVersion: 0, toVersion: 1, migrate },
    ]).migrate(
      { hidden },
      { sourceVersion: 0, targetVersion: 1, context: undefined },
    ));

    expect(error).toMatchObject({
      code: "PROJECT_MIGRATION_INVALID_REQUEST",
      reachedVersion: 0,
    });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("rejects invalid step configuration without invoking accessors", async () => {
    let migrateReads = 0;
    const hostile = { id: "hostile", fromVersion: 0, toVersion: 1 };
    Object.defineProperty(hostile, "migrate", {
      get() {
        migrateReads += 1;
        return () => ({ status: "completed", document: {} });
      },
    });

    const error = await captureError(() => new ProjectMigrator([
      hostile as unknown as ProjectMigrationStep,
    ]));

    expect(error.code).toBe("PROJECT_MIGRATION_INVALID_CONFIG");
    expect(migrateReads).toBe(0);
    await expect(captureError(() => new ProjectMigrator([
      { id: "duplicate", fromVersion: 0, toVersion: 1, migrate: () => ({ status: "completed", document: {} }) },
      { id: "duplicate", fromVersion: 1, toVersion: 2, migrate: () => ({ status: "completed", document: {} }) },
    ]))).resolves.toMatchObject({ code: "PROJECT_MIGRATION_INVALID_CONFIG" });
  });

  it("rejects hostile request accessors without invoking them", async () => {
    let sourceReads = 0;
    const request = { targetVersion: 1, context: undefined };
    Object.defineProperty(request, "sourceVersion", {
      enumerable: true,
      get() {
        sourceReads += 1;
        return 0;
      },
    });

    const error = await captureError(() => new ProjectMigrator([]).migrate(
      {},
      request as unknown as {
        sourceVersion: number;
        targetVersion: number;
        context: undefined;
      },
    ));

    expect(error.code).toBe("PROJECT_MIGRATION_INVALID_REQUEST");
    expect(sourceReads).toBe(0);
  });

  it("types malformed step results without reading result or choice accessors", async () => {
    let statusReads = 0;
    const hostileResult = {};
    Object.defineProperty(hostileResult, "status", {
      enumerable: true,
      get() {
        statusReads += 1;
        return "completed";
      },
    });
    const invalidCompleted = new ProjectMigrator([
      { id: "hostile-result", fromVersion: 0, toVersion: 1, migrate: () => (
        hostileResult as unknown as { status: "completed"; document: unknown }
      ) },
    ]);
    const resultError = await captureError(() => invalidCompleted.migrate({}, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
    }));
    expect(resultError.code).toBe("PROJECT_MIGRATION_STEP_CONTRACT_INVALID");
    expect(statusReads).toBe(0);

    let choiceReads = 0;
    const choices = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    Object.defineProperty(choices, "0", {
      enumerable: true,
      get() {
        choiceReads += 1;
        return { id: "a", label: "A" };
      },
    });
    const invalidChoices = new ProjectMigrator([
      { id: "hostile-choices", fromVersion: 0, toVersion: 1, migrate: () => ({
        status: "needs-input",
        issues: [{
          code: "PICK",
          category: "ambiguity",
          severity: "error",
          blocking: true,
          path: "$.pick",
          message: "Pick one.",
          choices,
        }],
      }) },
    ]);
    const choiceError = await captureError(() => invalidChoices.migrate({}, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
    }));
    expect(choiceError.code).toBe("PROJECT_MIGRATION_STEP_CONTRACT_INVALID");
    expect(choiceReads).toBe(0);

    let thenReads = 0;
    const hostileThen = { status: "completed", document: { safe: true } };
    // oxlint-disable-next-line unicorn/no-thenable -- Deliberate hostile Promise-assimilation boundary.
    Object.defineProperty(hostileThen, "then", {
      enumerable: true,
      get() {
        thenReads += 1;
        throw new Error("then getter invoked");
      },
    });
    const thenError = await captureError(() => new ProjectMigrator([{
      id: "hostile-then",
      fromVersion: 0,
      toVersion: 1,
      migrate: () => hostileThen as never,
    }]).migrate({}, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
    }));
    expect(thenError.code).toBe("PROJECT_MIGRATION_STEP_CONTRACT_INVALID");
    expect(thenReads).toBe(0);
  });

  it("supports PromiseLike steps through data-method thenables", async () => {
    const thenable = Object.create(null) as PromiseLike<{
      status: "completed";
      document: { schemaVersion: number };
    }>;
    // oxlint-disable-next-line unicorn/no-thenable -- The public step contract explicitly accepts PromiseLike.
    Object.defineProperty(thenable, "then", {
      enumerable: true,
      value(resolve: (result: unknown) => void) {
        resolve({ status: "completed", document: { schemaVersion: 1 } });
      },
    });
    const result = await new ProjectMigrator([{
      id: "thenable",
      fromVersion: 0,
      toVersion: 1,
      migrate: () => thenable,
    }]).migrate({}, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
    });

    expect(result.document).toEqual({ schemaVersion: 1 });
    expect(result.report.reachedVersion).toBe(1);
  });

  it("enforces completed/needs-input blocking invariants", async () => {
    const blockingLoss = {
      code: "DROPPED_DATA",
      category: "loss" as const,
      severity: "error" as const,
      blocking: true,
      path: "$.legacy",
      message: "Legacy data cannot be represented.",
    };
    const cases = [
      { status: "completed", document: {}, issues: [blockingLoss] },
      { status: "needs-input", issues: [changeIssue] },
    ];
    for (const [index, returned] of cases.entries()) {
      const migrator = new ProjectMigrator([
        {
          id: `invalid-${index}`,
          fromVersion: 0,
          toVersion: 1,
          migrate: () => returned as never,
        },
      ]);
      await expect(captureError(() => migrator.migrate({}, {
        sourceVersion: 0,
        targetVersion: 1,
        context: undefined,
      }))).resolves.toMatchObject({ code: "PROJECT_MIGRATION_STEP_CONTRACT_INVALID" });
    }
  });

  it("contains invalid requests, cyclic documents, and step failures as diagnostics", async () => {
    const migrator = new ProjectMigrator([
      { id: "throws", fromVersion: 0, toVersion: 1, migrate: () => { throw new Error("secret"); } },
    ]);
    await expect(captureError(() => migrator.migrate({}, {
      sourceVersion: 1.5,
      targetVersion: 2,
      context: undefined,
    }))).resolves.toMatchObject({ code: "PROJECT_MIGRATION_INVALID_REQUEST" });
    await expect(captureError(() => migrator.migrate({}, {
      sourceVersion: 2,
      targetVersion: 1,
      context: undefined,
    }))).resolves.toMatchObject({ code: "PROJECT_MIGRATION_INVALID_REQUEST" });

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expect(captureError(() => migrator.migrate(cyclic, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
    }))).resolves.toMatchObject({ code: "PROJECT_MIGRATION_INVALID_REQUEST" });

    const failed = await captureError(() => migrator.migrate({}, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
    }));
    expect(failed).toMatchObject({
      code: "PROJECT_MIGRATION_STEP_FAILED",
      stepId: "throws",
      reachedVersion: 0,
    });
    expect(failed.cause).toBeInstanceOf(Error);
    expect(failed.toDiagnostic()).not.toHaveProperty("cause");
    expect(JSON.stringify(failed.toDiagnostic())).not.toContain("secret");
  });

  it("aborts before work and promptly races a non-cooperative async step", async () => {
    const controller = new AbortController();
    controller.abort("cancelled-before-start");
    const called = vi.fn();
    const migrator = new ProjectMigrator([
      { id: "wait", fromVersion: 0, toVersion: 1, migrate: called },
    ]);
    await expect(captureError(() => migrator.migrate({}, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
      signal: controller.signal,
    }))).resolves.toMatchObject({ code: "PROJECT_MIGRATION_ABORTED", reachedVersion: 0 });
    expect(called).not.toHaveBeenCalled();

    const during = new AbortController();
    const started = vi.fn(() => new Promise<never>(() => undefined));
    const pending = new ProjectMigrator([
      { id: "never", fromVersion: 0, toVersion: 1, migrate: started },
    ]).migrate({}, {
      sourceVersion: 0,
      targetVersion: 1,
      context: undefined,
      signal: during.signal,
    });
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    during.abort("cancelled-during-step");
    const error = await captureError(() => pending);
    expect(error).toMatchObject({
      code: "PROJECT_MIGRATION_ABORTED",
      stepId: "never",
      reachedVersion: 0,
    });
    expect(error.cause).toBe("cancelled-during-step");
  });
});
