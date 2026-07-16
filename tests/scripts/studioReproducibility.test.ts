import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateEvidence,
  evaluateGitAttributesContract,
  evaluateLockContract,
  evaluatePackageContract,
  evaluateWorkflowContract,
  parseReproducibilityArguments,
  runReproducibilityCli,
  runReproducibilityProbe,
} from "../../scripts/studio-reproducibility.mjs";

const ACTIONS = [
  "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
  "actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f",
];
const EXPECTED_INSTALL_ARGV = [
  "install",
  "--frozen-lockfile",
  "--lockfile-only",
  "--ignore-scripts",
];
const EXPECTED_TIMEOUT_MS = 120_000;
const PINNED_BUN_RUNTIME = { runtimeVersion: "1.3.14", execPath: "C:/bun.exe" };
const EXPECTED_OVERRIDES = {
  protobufjs: "7.6.5",
  undici: "7.28.0",
  ws: "8.21.1",
};
const roots: string[] = [];
const managedReproRoots: string[] = [];

type LockFixture = {
  workspaces: { "": { dependencies: Record<string, string>; devDependencies: Record<string, string> } };
  overrides: Record<string, string>;
};

type WorkflowStepFixture = {
  name: string;
  uses?: string;
  with?: Record<string, unknown>;
  shell?: string;
  run?: string;
};

type WorkflowFixture = {
  name: string;
  on: { push?: { branches: string[] }; "pull_request": null };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: {
    "studio-quality": {
      name: string;
      "runs-on": string;
      "timeout-minutes": number;
      steps: WorkflowStepFixture[];
    };
  };
};

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "studio-repro-test-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "fixture",
    packageManager: "bun@1.3.14",
    engines: { node: ">=24.0.0" },
    dependencies: { react: "^19.2.7" },
    devDependencies: {},
    overrides: EXPECTED_OVERRIDES,
  }, null, 2));
  writeFileSync(join(root, ".gitattributes"), "bun.lock text eol=lf\n");
  writeFileSync(join(root, "bun.lock"), JSON.stringify({
    lockfileVersion: 1,
    workspaces: { "": { dependencies: { react: "^19.2.7" }, devDependencies: {} } },
    overrides: EXPECTED_OVERRIDES,
  }));
  const workflow = readFileSync(resolve(".github/workflows/studio-quality.yml"), "utf8");
  const workflowPath = join(root, ".github", "workflows");
  // The fixture uses the repository workflow as data, but keeps the probe's
  // root disposable and independent from the checked-out lockfile.
  mkdirSync(workflowPath, { recursive: true });
  writeFileSync(join(workflowPath, "studio-quality.yml"), workflow);
  return root;
}

function workflowDocument(): WorkflowFixture {
  return {
    name: "Studio quality",
    on: { push: { branches: ["main"] }, "pull_request": null },
    permissions: { contents: "read" },
    concurrency: { group: "studio-quality-${{ github.workflow }}-${{ github.ref }}", "cancel-in-progress": true },
    jobs: {
      "studio-quality": {
        name: "Studio quality gates",
        "runs-on": "ubuntu-24.04",
        "timeout-minutes": 30,
        steps: [
          { name: "Check out source", uses: ACTIONS[0], with: { "persist-credentials": false } },
          { name: "Set up Bun", uses: ACTIONS[1], with: { "bun-version": "1.3.14" } },
          { name: "Set up Node.js", uses: ACTIONS[2], with: { "node-version": "24.18.0" } },
          { name: "Verify Chrome executable", shell: "bash", run: "command -v google-chrome\nSTUDIO_CHROME_PATH" },
          { name: "Install frozen dependencies", run: "bun install --frozen-lockfile --ignore-scripts" },
          { name: "Audit high-severity vulnerabilities", run: "bun audit --audit-level=high" },
          { name: "Run all studio gates", run: "bun scripts/studio-gates.mjs --gate all" },
          { name: "Run production browser smoke gate", run: "bun scripts/studio-gates.mjs --gate e2e" },
        ],
      },
    },
  };
}

afterEach(() => {
  const rootsToVerify = managedReproRoots.splice(0);
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
  for (const root of rootsToVerify) expect(existsSync(root)).toBe(false);
});

describe("reproducibility contract evaluators", () => {
  it("accepts the pinned package manager and a Node 24-compatible engine", () => {
    expect(evaluatePackageContract({
      packageManager: "bun@1.3.14",
      engines: { node: ">=24.0.0" },
      overrides: EXPECTED_OVERRIDES,
    })).toMatchObject({ valid: true, errors: [] });
    expect(evaluatePackageContract({ packageManager: "npm@11", engines: { node: "^20" } })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["package-manager-mismatch", "node-engine-mismatch", "overrides-mismatch"]),
    });
    expect(evaluatePackageContract({
      packageManager: "bun@1.3.14",
      engines: { node: ">=24.999" },
      overrides: EXPECTED_OVERRIDES,
    })).toMatchObject({ valid: false, errors: expect.arrayContaining(["node-engine-mismatch"]) });
    expect(evaluatePackageContract("{" )).toMatchObject({ valid: false, errors: ["invalid-json", "package-not-object"] });
    expect(evaluatePackageContract(null).valid).toBe(false);
  });

  it("requires the checkout EOL policy that keeps bun.lock byte-stable", () => {
    expect(evaluateGitAttributesContract("bun.lock text eol=lf\n")).toMatchObject({ valid: true, errors: [] });
    expect(evaluateGitAttributesContract("# missing lock policy\n")).toMatchObject({
      valid: false,
      errors: ["gitattributes-lock-eol-mismatch"],
    });
    expect(evaluateGitAttributesContract("bun.lock -text\nbun.lock text eol=lf\n")).toMatchObject({
      valid: false,
      errors: ["gitattributes-lock-eol-mismatch"],
    });
    expect(evaluateGitAttributesContract("bun.lock text eol=lf\r\n")).toMatchObject({ valid: true });
  });

  it("compares lock root metadata exactly, including old-compatible, missing and extra entries", () => {
    const packageDocument = {
      packageManager: "bun@1.3.14",
      engines: { node: ">=24.0.0" },
      dependencies: { react: "^19.2.7" },
      devDependencies: { vitest: "^4.1.10" },
      overrides: EXPECTED_OVERRIDES,
    };
    const lockDocument: LockFixture = {
      workspaces: { "": {
        dependencies: { react: "^19.2.7" },
        devDependencies: { vitest: "^4.1.10" },
      } },
      overrides: EXPECTED_OVERRIDES,
    };
    expect(evaluateLockContract(packageDocument, JSON.stringify(lockDocument))).toMatchObject({ valid: true, errors: [] });

    const stale = structuredClone(lockDocument);
    stale.workspaces[""].dependencies.react = "^19.2.6";
    expect(evaluateLockContract(packageDocument, JSON.stringify(stale))).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["dependencies-mismatch"]),
    });

    const missing = structuredClone(lockDocument);
    delete missing.workspaces[""].devDependencies.vitest;
    expect(evaluateLockContract(packageDocument, JSON.stringify(missing))).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["dev-dependencies-mismatch"]),
    });

    const extra = structuredClone(lockDocument);
    extra.workspaces[""].dependencies.extra = "^1.0.0";
    expect(evaluateLockContract(packageDocument, JSON.stringify(extra))).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["dependencies-mismatch"]),
    });
    expect(evaluateLockContract(packageDocument, "{ malformed")).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["malformed-lock"]),
    });
  });

  it("requires immutable action SHAs, least privilege, bounded gates and Chrome proof", () => {
    const workflow = readFileSync(resolve(".github/workflows/studio-quality.yml"), "utf8");
    const result = evaluateWorkflowContract(workflow, { parseYaml: workflowDocument });
    expect(result).toMatchObject({ valid: true, errors: [], actions: ACTIONS });
    const tamperedDocument = workflowDocument();
    tamperedDocument.jobs["studio-quality"].steps[1].uses = "oven-sh/setup-bun@main";
    expect(evaluateWorkflowContract(workflow, { parseYaml: () => tamperedDocument })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["actions-mismatch"]),
    });
    expect(evaluateWorkflowContract(workflow, {
      parseYaml: () => ({ ...workflowDocument(), "continue-on-error": true }),
    })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["continue-on-error-forbidden"]),
    });
    expect(evaluateWorkflowContract("name: malformed\njobs: {}\n", {
      parseYaml: () => { throw new Error("malformed"); },
    }).valid).toBe(false);
    expect(evaluateWorkflowContract(workflow, { parseYaml: null }).valid).toBe(false);
    expect(evaluateWorkflowContract({} as unknown as string, { parseYaml: workflowDocument }).valid).toBe(false);

    const triggerLoss = workflowDocument();
    delete triggerLoss.on.push;
    expect(evaluateWorkflowContract(workflow, { parseYaml: () => triggerLoss })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["workflow-trigger-mismatch"]),
    });
    const shortTimeout = workflowDocument();
    shortTimeout.jobs["studio-quality"]["timeout-minutes"] = 1;
    expect(evaluateWorkflowContract(workflow, { parseYaml: () => shortTimeout })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["timeout-mismatch"]),
    });
    const branchAgnostic = workflowDocument();
    branchAgnostic.concurrency.group = "studio-quality-${{ github.workflow }}";
    expect(evaluateWorkflowContract(workflow, { parseYaml: () => branchAgnostic })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["concurrency-mismatch"]),
    });
    const installBeforeSetup = workflowDocument();
    const ordered = installBeforeSetup.jobs["studio-quality"].steps;
    installBeforeSetup.jobs["studio-quality"].steps = [ordered[4], ...ordered.slice(0, 4), ...ordered.slice(5)];
    expect(evaluateWorkflowContract(workflow, { parseYaml: () => installBeforeSetup })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["steps-order-mismatch"]),
    });
  });

  it("rejects malformed or false-green evidence instead of trusting status text", () => {
    const valid = {
      packageContract: { valid: true },
      gitattributesContract: { valid: true },
      lockContract: { valid: true },
      workflowContract: { valid: true },
      baseline: {
        status: "passed", exitCode: 0, lockUnchanged: true,
        lockDigestBefore: "digest", lockDigestAfter: "digest",
      },
      drift: {
        status: "failed", exitCode: 1, lockUnchanged: true,
        lockDigestBefore: "digest", lockDigestAfter: "digest",
      },
      execution: { command: "bun", argv: [...EXPECTED_INSTALL_ARGV], shell: false, timeoutMs: EXPECTED_TIMEOUT_MS },
      cleanup: { status: "passed" },
    };
    expect(evaluateEvidence(valid)).toMatchObject({ valid: true, errors: [] });
    expect(evaluateEvidence({ ...valid, baseline: { ...valid.baseline, exitCode: 1 } })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["baseline-failed"]),
    });
    expect(evaluateEvidence({ ...valid, drift: { ...valid.drift, exitCode: 0 } })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["drift-not-rejected"]),
    });
    expect(evaluateEvidence({ ...valid, execution: { ...valid.execution, shell: true } })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["execution-contract-failed"]),
    });
    expect(evaluateEvidence(null).valid).toBe(false);
  });
});

describe("reproducibility probe", () => {
  it("proves baseline success and incompatible manifest rejection without mutating lock", () => {
    const root = makeRoot();
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      return { status: calls.length === 1 ? 0 : 1 };
    });
    const report = runReproducibilityProbe({ root, spawnSync: spawn, parseYaml: workflowDocument, ...PINNED_BUN_RUNTIME });
    expect(report.status).toBe("passed");
    expect(report.evidence.baseline).toMatchObject({ status: "passed", exitCode: 0, lockUnchanged: true });
    expect(report.evidence.drift).toMatchObject({ status: "failed", exitCode: 1, lockUnchanged: true });
    expect(calls).toHaveLength(2);
    expect(calls.every(({ command, args, options }) => {
      return command === "C:/bun.exe" && JSON.stringify(args) === JSON.stringify(EXPECTED_INSTALL_ARGV)
        && options.shell === false && options.timeout === EXPECTED_TIMEOUT_MS;
    })).toBe(true);
    expect(JSON.stringify(report)).not.toContain(root);
  });

  it("fails closed on baseline failure, lock mutation, execution failure and cleanup failure", () => {
    const baselineRoot = makeRoot();
    const baselineFailure = runReproducibilityProbe({
      root: baselineRoot,
      spawnSync: vi.fn().mockReturnValue({ status: 7 }),
      parseYaml: workflowDocument,
      ...PINNED_BUN_RUNTIME,
    });
    expect(baselineFailure.status).toBe("failed");
    expect(baselineFailure.evidence.baseline).toMatchObject({ status: "failed", exitCode: 7 });

    const mutationRoot = makeRoot();
    const mutate = vi.fn((_: string, __: string[], options: { cwd: string }) => {
      if (mutate.mock.calls.length === 1) writeFileSync(join(options.cwd, "bun.lock"), "mutated\n");
      return { status: mutate.mock.calls.length === 1 ? 0 : 1 };
    });
    const mutation = runReproducibilityProbe({ root: mutationRoot, spawnSync: mutate, parseYaml: workflowDocument, ...PINNED_BUN_RUNTIME });
    expect(mutation.status).toBe("failed");
    expect(mutation.evidence.baseline).toMatchObject({ status: "failed", reason: "lock-mutated" });

    const executionRoot = makeRoot();
    const execution = runReproducibilityProbe({
      root: executionRoot,
      spawnSync: () => { throw new Error("secret"); },
      parseYaml: workflowDocument,
      ...PINNED_BUN_RUNTIME,
    });
    expect(execution.status).toBe("failed");
    expect(JSON.stringify(execution)).not.toContain("secret");

    const cleanupRoot = makeRoot();
    const cleanup = runReproducibilityProbe({
      root: cleanupRoot,
      spawnSync: vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 }),
      parseYaml: workflowDocument,
      fs: {
        mkdtempSync: (prefix: string) => {
          const managed = mkdtempSync(prefix);
          roots.push(managed);
          managedReproRoots.push(managed);
          return managed;
        },
        rmSync: () => { throw new Error("private cleanup detail"); },
      },
      ...PINNED_BUN_RUNTIME,
    });
    expect(cleanup.status).toBe("failed");
    expect(cleanup.evidence.cleanup).toMatchObject({ status: "failed", reason: "cleanup-failure" });
    expect(JSON.stringify(cleanup)).not.toContain("private cleanup detail");

    const boundaryRoot = makeRoot();
    const externalRoot = mkdtempSync(join(tmpdir(), "external-repro-test-"));
    roots.push(externalRoot);
    const remove = vi.fn();
    const boundary = runReproducibilityProbe({
      root: boundaryRoot,
      spawnSync: vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 }),
      parseYaml: workflowDocument,
      fs: { mkdtempSync: () => externalRoot, rmSync: remove },
      ...PINNED_BUN_RUNTIME,
    });
    expect(boundary.status).toBe("failed");
    expect(boundary.evidence.cleanup).toMatchObject({ status: "failed", reason: "cleanup-boundary" });
    expect(remove).not.toHaveBeenCalled();

    const runtimeRoot = makeRoot();
    const runtimeSpawn = vi.fn();
    const runtime = runReproducibilityProbe({
      root: runtimeRoot,
      spawnSync: runtimeSpawn,
      parseYaml: workflowDocument,
      runtimeVersion: "1.3.9",
      execPath: "C:/bun.exe",
    });
    expect(runtime.status).toBe("failed");
    expect(runtime.errors).toContain("bun-runtime-mismatch");
    expect(runtimeSpawn).not.toHaveBeenCalled();

    const executableRoot = makeRoot();
    const executableSpawn = vi.fn();
    const executable = runReproducibilityProbe({
      root: executableRoot,
      spawnSync: executableSpawn,
      parseYaml: workflowDocument,
      ...PINNED_BUN_RUNTIME,
      execPath: "C:/node.exe",
    });
    expect(executable.status).toBe("failed");
    expect(executable.errors).toContain("bun-runtime-mismatch");
    expect(executableSpawn).not.toHaveBeenCalled();
  });

  it("parses hostile CLI arguments and emits a data-only failure report", () => {
    expect(parseReproducibilityArguments([]).timeoutMs).toBe(EXPECTED_TIMEOUT_MS);
    expect(parseReproducibilityArguments(["--root", "fixture", "--timeout-ms=1000"])).toEqual({
      root: "fixture",
      timeoutMs: 1000,
    });
    expect(() => parseReproducibilityArguments(["--root"])).toThrow(/requires a path/);
    expect(() => parseReproducibilityArguments(["--timeout-ms", "0"])).toThrow(/between 1/);
    expect(() => parseReproducibilityArguments(["--unknown"])).toThrow(/Unknown reproducibility argument/);

    const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    expect(runReproducibilityCli(["--root", "missing"], io)).toBe(1);
    expect(io.stdout.write).toHaveBeenCalledOnce();
    expect(String(io.stdout.write.mock.calls[0]?.[0])).not.toContain("D:\\DEV");
  });
});

// Keep the fixture setup's copy helper used by the tests' path contract.
it("keeps the repository workflow available as fixture input", () => {
  const root = makeRoot();
  const target = join(root, "workflow-copy.yml");
  copyFileSync(resolve(".github/workflows/studio-quality.yml"), target);
  expect(readFileSync(target, "utf8")).toContain("studio-gates.mjs --gate all");
});
