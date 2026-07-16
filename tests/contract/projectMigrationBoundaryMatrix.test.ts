import { describe, expect, it } from "vitest";
import {
  ProjectMigrator,
  isProjectMigrationError,
} from "../../core/persistence";
import type { ProjectMigrationStepResult } from "../../core/persistence";

async function expectMigrationError(
  work: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    expect(isProjectMigrationError(error)).toBe(true);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error("Expected a typed project migration error.");
}

function invalidStepResult(value: unknown): Promise<unknown> {
  return new ProjectMigrator([{
    id: "boundary-step",
    fromVersion: 0,
    toVersion: 1,
    migrate: () => value as ProjectMigrationStepResult,
  }]).migrate({}, {
    sourceVersion: 0,
    targetVersion: 1,
    context: undefined,
  });
}

const issueBase = {
  code: "BOUNDARY",
  path: "$.asset",
  message: "Boundary issue",
};

describe("project migration boundary matrix", () => {
  it("rejects non-array, unreadable, sparse and null step configurations", () => {
    const unreadableLength = new Proxy([], {
      getOwnPropertyDescriptor(target, key) {
        if (key === "length") throw new Error("fixture length failure");
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const sparseSteps: unknown[] = [];
    sparseSteps.length = 1;

    for (const steps of [null, unreadableLength, sparseSteps, [null]]) {
      expect(() => new ProjectMigrator(steps as never)).toThrowError(expect.objectContaining({
        code: "PROJECT_MIGRATION_INVALID_CONFIG",
      }));
    }
  });

  it("rejects every non-data-only document container", async () => {
    const namedArray: unknown[] = [];
    Object.defineProperty(namedArray, "named", { enumerable: true, value: true });
    const symbolDocument = { value: true } as Record<PropertyKey, unknown>;
    symbolDocument[Symbol("hidden")] = true;
    const accessorDocument = {};
    Object.defineProperty(accessorDocument, "value", {
      enumerable: true,
      get: () => true,
    });

    for (const document of [namedArray, new Date(), symbolDocument, accessorDocument]) {
      await expectMigrationError(
        () => new ProjectMigrator([]).migrate(document, {
          sourceVersion: 0,
          targetVersion: 0,
          context: undefined,
        }),
        "PROJECT_MIGRATION_INVALID_REQUEST",
      );
    }
  });

  it("rejects malformed issue containers and every typed issue boundary", async () => {
    const invalidResults: unknown[] = [
      { status: "completed", document: {}, issues: {} },
      {
        status: "completed",
        document: {},
        issues: [{ ...issueBase, code: "", category: "change", severity: "info", blocking: false }],
      },
      {
        status: "needs-input",
        issues: [{ ...issueBase, category: "needs-relink", severity: "error", blocking: true }],
      },
      {
        status: "needs-input",
        issues: [{
          ...issueBase,
          category: "ambiguity",
          severity: "error",
          blocking: true,
          choices: [],
        }],
      },
      {
        status: "completed",
        document: {},
        issues: [{ ...issueBase, category: "warning", severity: "error", blocking: false }],
      },
      {
        status: "needs-input",
        issues: [{
          ...issueBase,
          category: "ambiguity",
          severity: "error",
          blocking: true,
          choices: [{ id: "", label: "Invalid" }, { id: "valid", label: "Valid" }],
        }],
      },
    ];

    for (const result of invalidResults) {
      await expectMigrationError(
        () => invalidStepResult(result),
        "PROJECT_MIGRATION_STEP_CONTRACT_INVALID",
      );
    }
  });
});
