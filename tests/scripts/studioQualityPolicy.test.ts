import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BUNDLE_THRESHOLDS,
  COVERAGE_SOURCE_PATTERNS,
  COVERAGE_TEST_PATHS,
  COVERAGE_THRESHOLDS,
  FIXTURE_RETENTION_MANIFEST_PATH,
  captureFixtureInventory,
  coverageCommandArgs,
  evaluateCoverageSummary,
  evaluateBundleEvidence,
  evaluateFixtureInventory,
  extractInitialJsPaths,
  parseFixtureRetentionManifest,
  parseQualityArguments,
  retainedContentIdentity,
  runCoverageCheck,
  runBundleCheck,
  runQualityPolicyCli,
} from "../../scripts/studio-quality-policy.mjs";

function coverageSummary() {
  return {
    total: {
      statements: { total: 9170, covered: 7546, skipped: 0, pct: 82.29 },
      branches: { total: 6751, covered: 5182, skipped: 0, pct: 76.75 },
      functions: { total: 1317, covered: 1208, skipped: 0, pct: 91.72 },
      lines: { total: 8146, covered: 7018, skipped: 0, pct: 86.15 },
    },
    "D:\\workspace\\core\\project\\factory.ts": {},
  };
}

function outputBuffer() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value: string) => stdout.push(value) },
      stderr: { write: (value: string) => stderr.push(value) },
    },
  };
}

describe("canonical coverage policy", () => {
  it("freezes the full test/source scope and separate ratchet/release thresholds", () => {
    expect(COVERAGE_TEST_PATHS).toEqual([
      "tests/components",
      "tests/hooks",
      "tests/scripts",
      "tests/types",
      "tests/utils",
      "tests/contract",
      "tests/integration",
    ]);
    expect(COVERAGE_SOURCE_PATTERNS).toEqual({
      include: ["core/**/*.ts"],
      exclude: ["core/**/index.ts"],
    });
    expect(COVERAGE_THRESHOLDS.ratchet).toEqual({
      statements: 82.29,
      branches: 76.75,
      functions: 91.72,
      lines: 86.15,
    });
    expect(COVERAGE_THRESHOLDS.release).toEqual({
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90,
    });
    expect(Object.isFrozen(COVERAGE_THRESHOLDS.ratchet)).toBe(true);
    expect(coverageCommandArgs()).toContain("--coverage.include=core/**/*.ts");
  });

  it("passes the measured ratchet and deliberately fails the unchanged release target", () => {
    const ratchet = evaluateCoverageSummary(coverageSummary(), "ratchet");
    expect(ratchet).toMatchObject({ status: "pass", includesCoreProject: true, below: [] });

    const release = evaluateCoverageSummary(coverageSummary(), "release");
    expect(release).toMatchObject({
      status: "fail",
      includesCoreProject: true,
      below: ["statements", "branches", "lines"],
    });
  });

  it("rejects missing, impossible or unknown coverage data", () => {
    expect(() => evaluateCoverageSummary({}, "ratchet")).toThrow(/invalid/);
    expect(() => evaluateCoverageSummary(coverageSummary(), "private"))
      .toThrow(/Unknown coverage profile/);
    const invalid = coverageSummary();
    invalid.total.lines.pct = Number.NaN;
    expect(() => evaluateCoverageSummary(invalid, "ratchet")).toThrow(/invalid/);
    const inconsistent = coverageSummary();
    inconsistent.total.lines.pct = 99;
    expect(() => evaluateCoverageSummary(inconsistent, "ratchet")).toThrow(/inconsistent/);
    const impossibleSkipped = coverageSummary();
    impossibleSkipped.total.lines.skipped = impossibleSkipped.total.lines.total;
    expect(() => evaluateCoverageSummary(impossibleSkipped, "ratchet")).toThrow(/invalid/);
  });

  it("spawns fixed Vitest argv without a shell and refuses stale/missing summaries", () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    const remove = vi.fn();
    const result = runCoverageCheck("ratchet", {
      cwd: "D:/workspace",
      spawnSync: spawn,
      rmSync: remove,
      readFileSync: () => JSON.stringify(coverageSummary()),
      stdio: "pipe",
    });
    expect(result.status).toBe("pass");
    expect(remove).toHaveBeenCalledWith(
      expect.stringMatching(/coverage-summary\.json$/),
      { force: true },
    );
    expect(spawn).toHaveBeenCalledWith(
      "bun",
      coverageCommandArgs(),
      expect.objectContaining({ shell: false, stdio: "pipe", timeout: 300_000 }),
    );

    expect(runCoverageCheck("ratchet", {
      spawnSync: () => ({ status: 0 }),
      rmSync: vi.fn(),
      readFileSync: () => "stale-or-invalid",
      stdio: "pipe",
    })).toMatchObject({ status: "fail", reason: "invalid-summary" });
    expect(runCoverageCheck("ratchet", {
      rmSync: () => { throw new Error("private filesystem detail"); },
      stdio: "pipe",
    })).toMatchObject({ status: "fail", reason: "execution-unavailable" });
  });
});

describe("initial bundle policy", () => {
  it("extracts only local initial module assets and keeps release stricter than ratchet", () => {
    expect(extractInitialJsPaths(`
      <link rel="modulepreload" href="/assets/vendor-A.js">
      <script src="/assets/index-B.js" type="module"></script>
      <script src="/assets/legacy.js"></script>
    `)).toEqual(["/assets/index-B.js", "/assets/vendor-A.js"]);
    expect(BUNDLE_THRESHOLDS).toEqual({
      ratchet: { initialJsGzipBytes: 245_999 },
      release: { initialJsGzipBytes: 180_000 },
    });
    expect(evaluateBundleEvidence({
      initialChunkCount: 1,
      initialJsBytes: 918_701,
      initialJsGzipBytes: 245_999,
    }, "ratchet").status).toBe("pass");
    expect(evaluateBundleEvidence({
      initialChunkCount: 1,
      initialJsBytes: 918_701,
      initialJsGzipBytes: 245_999,
    }, "release")).toMatchObject({ status: "fail", exceeded: ["initialJsGzipBytes"] });
    expect(() => extractInitialJsPaths(
      `<script type="module" src="https://private.invalid/app.js"></script>`,
    )).toThrow(/invalid/);
    expect(() => extractInitialJsPaths(
      `<script data-type="module" data-src="/assets/private.js"></script>`,
    )).toThrow(/invalid/);
    expect(extractInitialJsPaths(`
      <link rel="PREFETCH modulepreload" href="/assets/vendor-A.js">
      <script type="MODULE" src="/assets/index-B.js"></script>
    `)).toEqual(["/assets/index-B.js", "/assets/vendor-A.js"]);
  });

  it("measures fixed production assets with level-9 gzip and fails closed on stale builds", () => {
    const read = vi.fn(() => `<script type="module" src="/assets/index-A.js"></script>`);
    const spawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        initialChunkCount: 1,
        initialJsBytes: 15,
        initialJsGzipBytes: 100,
      }),
    });
    expect(runBundleCheck("ratchet", { readFileSync: read, spawnSync: spawn })).toMatchObject({
      status: "pass",
      metrics: { initialChunkCount: 1, initialJsBytes: 15, initialJsGzipBytes: 100 },
    });
    expect(spawn).toHaveBeenCalledWith(
      "node",
      ["scripts/studio-gzip-size.mjs", "dist/assets/index-A.js"],
      expect.objectContaining({ shell: false, encoding: "utf8", timeout: 30_000 }),
    );
    expect(runBundleCheck("ratchet", {
      readFileSync: () => { throw new Error("private build path"); },
    })).toMatchObject({ status: "fail", reason: "invalid-or-unavailable-build" });
    expect(runBundleCheck("ratchet", {
      readFileSync: read,
      spawnSync: () => ({
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          initialChunkCount: 2,
          initialJsBytes: 15,
          initialJsGzipBytes: 100,
        }),
      }),
    })).toMatchObject({ status: "fail", reason: "invalid-or-unavailable-build" });
  });
});

describe("fixture and golden retention", () => {
  it("accepts the exhaustive tracked inventory and detects hash or root drift", () => {
    const manifest = parseFixtureRetentionManifest(JSON.parse(readFileSync(
      resolve(FIXTURE_RETENTION_MANIFEST_PATH),
      "utf8",
    )));
    const inventory = captureFixtureInventory(manifest);
    expect(evaluateFixtureInventory(manifest, inventory)).toMatchObject({
      status: "pass",
      retainedCount: 7,
      rootCount: 2,
    });

    const firstPath = String(manifest.entries[0]!.path);
    const records = inventory.records as Record<string, {
      tracked: boolean;
      bytes: number;
      sha256: string;
    }>;
    const driftedInventory = {
      discovered: inventory.discovered,
      records: {
        ...records,
        [firstPath]: { ...records[firstPath]!, sha256: "0".repeat(64) },
      },
    };
    expect(evaluateFixtureInventory(manifest, driftedInventory)).toMatchObject({
      status: "fail",
      drifted: [firstPath],
    });

    expect(evaluateFixtureInventory(manifest, {
      ...inventory,
      discovered: [...inventory.discovered, `${manifest.roots[0]}/unmanifested.json`],
    })).toMatchObject({ status: "fail", unmanifested: [expect.stringContaining("unmanifested")] });
  });

  it("uses fixed git argv and rejects malformed/traversing manifests", () => {
    const raw = JSON.parse(readFileSync(resolve(FIXTURE_RETENTION_MANIFEST_PATH), "utf8"));
    const manifest = parseFixtureRetentionManifest(raw);
    const tracked = manifest.entries.map(({ path }: { path: string }) => path).join("\n");
    const spawn = vi.fn().mockReturnValue({ status: 0, stdout: `${tracked}\n` });
    expect(captureFixtureInventory(manifest, { spawnSync: spawn }).records).toBeDefined();
    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["ls-files", "--", ...manifest.entries.map(({ path }: { path: string }) => path)],
      expect.objectContaining({ shell: false, encoding: "utf8" }),
    );
    expect(() => captureFixtureInventory(manifest, {
      lstatSync: () => ({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => true,
      }),
    })).toThrow(/physical directory/);

    expect(retainedContentIdentity("text-lf", Buffer.from("alpha\r\nbeta\r\n")))
      .toEqual(retainedContentIdentity("text-lf", Buffer.from("alpha\nbeta\n")));
    expect(retainedContentIdentity("binary", Buffer.from("alpha\r\nbeta\r\n")))
      .not.toEqual(retainedContentIdentity("binary", Buffer.from("alpha\nbeta\n")));

    expect(() => parseFixtureRetentionManifest({
      ...raw,
      entries: [{ ...raw.entries[0], path: "../private.txt" }],
    })).toThrow(/path is invalid/);
    expect(() => parseFixtureRetentionManifest({
      ...raw,
      entries: [{ ...raw.entries[0], mode: "platform-text" }],
    })).toThrow(/entry is invalid/);
  });
});

describe("quality policy CLI", () => {
  it("parses only allowlisted checks/profiles and returns stable exit codes", () => {
    expect(parseQualityArguments(["coverage"])).toEqual({ check: "coverage", profile: "ratchet" });
    expect(parseQualityArguments(["coverage", "--profile", "release"]))
      .toEqual({ check: "coverage", profile: "release" });
    expect(parseQualityArguments(["fixtures"])).toEqual({ check: "fixtures", profile: null });
    expect(parseQualityArguments(["bundle", "--profile", "release"]))
      .toEqual({ check: "bundle", profile: "release" });
    expect(() => parseQualityArguments(["coverage", "--profile", "private"])).toThrow(/invalid/);
    expect(() => parseQualityArguments(["fixtures", "--profile", "release"])).toThrow(/no arguments/);

    const output = outputBuffer();
    expect(runQualityPolicyCli(["coverage"], output.io, {
      spawnSync: () => ({ status: 0 }),
      rmSync: vi.fn(),
      readFileSync: () => JSON.stringify(coverageSummary()),
      stdio: "pipe",
    })).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({ check: "coverage", status: "pass" });

    const invalid = outputBuffer();
    expect(runQualityPolicyCli(["private"], invalid.io)).toBe(2);
    expect(invalid.stderr.join("")).toContain("Unknown quality policy check");
  });
});
