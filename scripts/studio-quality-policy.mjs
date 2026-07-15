/** Canonical coverage and retained fixture/golden quality policy. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const QUALITY_POLICY_SCHEMA_VERSION = 1;
export const COVERAGE_SUMMARY_PATH = "coverage/coverage-summary.json";
export const FIXTURE_RETENTION_MANIFEST_PATH = "quality/fixture-retention.json";

export const COVERAGE_TEST_PATHS = Object.freeze([
  "tests/components",
  "tests/hooks",
  "tests/scripts",
  "tests/types",
  "tests/utils",
  "tests/contract",
  "tests/integration",
]);

export const COVERAGE_SOURCE_PATTERNS = Object.freeze({
  include: Object.freeze(["core/**/*.ts"]),
  exclude: Object.freeze(["core/**/index.ts"]),
});

const COVERAGE_METRICS = Object.freeze(["statements", "branches", "functions", "lines"]);

function freezeThresholds(value) {
  return Object.freeze({
    statements: value.statements,
    branches: value.branches,
    functions: value.functions,
    lines: value.lines,
  });
}

export const COVERAGE_THRESHOLDS = Object.freeze({
  ratchet: freezeThresholds({ statements: 82.29, branches: 76.75, functions: 91.72, lines: 86.15 }),
  release: freezeThresholds({ statements: 90, branches: 85, functions: 90, lines: 90 }),
});

export function coverageCommandArgs() {
  return Object.freeze([
    "x",
    "vitest",
    "run",
    ...COVERAGE_TEST_PATHS,
    "--coverage",
    `--coverage.include=${COVERAGE_SOURCE_PATTERNS.include[0]}`,
    `--coverage.exclude=${COVERAGE_SOURCE_PATTERNS.exclude[0]}`,
    "--coverage.reporter=text-summary",
    "--coverage.reporter=json-summary",
    "--pool=threads",
    "--maxWorkers=3",
  ]);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMetric(total, metric) {
  const value = total[metric];
  if (!isRecord(value)) throw new TypeError("Coverage summary metric is invalid.");
  const { pct, covered, skipped, total: count } = value;
  if (
    typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100 ||
    !Number.isSafeInteger(covered) || covered < 0 ||
    !Number.isSafeInteger(skipped) || skipped < 0 ||
    !Number.isSafeInteger(count) || count <= 0 || covered > count || skipped > count || covered + skipped > count
  ) {
    throw new TypeError("Coverage summary metric is invalid.");
  }
  const computedPct = Math.floor((covered / count) * 10_000) / 100;
  if (Math.abs(computedPct - pct) > 0.001) {
    throw new TypeError("Coverage summary percentage is inconsistent.");
  }
  return Object.freeze({ pct, covered, total: count });
}

export function evaluateCoverageSummary(summary, profile = "ratchet") {
  if (!Object.hasOwn(COVERAGE_THRESHOLDS, profile)) throw new TypeError("Unknown coverage profile.");
  if (!isRecord(summary) || !isRecord(summary.total)) {
    throw new TypeError("Coverage summary is invalid.");
  }
  const metrics = {};
  const below = [];
  const thresholds = COVERAGE_THRESHOLDS[profile];
  for (const metric of COVERAGE_METRICS) {
    metrics[metric] = readMetric(summary.total, metric);
    if (metrics[metric].pct < thresholds[metric]) below.push(metric);
  }
  return Object.freeze({
    schemaVersion: QUALITY_POLICY_SCHEMA_VERSION,
    check: "coverage",
    profile,
    status: below.length === 0 ? "pass" : "fail",
    includesCoreProject: Object.keys(summary).some((path) =>
      path.replaceAll("\\", "/").includes("/core/project/")),
    metrics: Object.freeze(metrics),
    thresholds,
    below: Object.freeze(below),
  });
}

export function runCoverageCheck(profile = "ratchet", options = {}) {
  if (!Object.hasOwn(COVERAGE_THRESHOLDS, profile)) throw new TypeError("Unknown coverage profile.");
  const cwd = resolve(options.cwd ?? process.cwd());
  const summaryPath = resolve(cwd, COVERAGE_SUMMARY_PATH);
  const spawn = options.spawnSync ?? spawnSync;
  const remove = options.rmSync ?? rmSync;
  const read = options.readFileSync ?? readFileSync;
  let processResult;
  try {
    remove(summaryPath, { force: true });
    processResult = spawn("bun", [...coverageCommandArgs()], {
      cwd,
      env: process.env,
      shell: false,
      stdio: options.stdio ?? "inherit",
      timeout: 300_000,
      windowsHide: true,
    });
  } catch {
    return Object.freeze({
      schemaVersion: QUALITY_POLICY_SCHEMA_VERSION,
      check: "coverage",
      profile,
      status: "fail",
      reason: "execution-unavailable",
    });
  }
  if (processResult.error || processResult.status !== 0) {
    return Object.freeze({
      schemaVersion: QUALITY_POLICY_SCHEMA_VERSION,
      check: "coverage",
      profile,
      status: "fail",
      reason: processResult.error?.code === "ETIMEDOUT" ? "timeout" : "test-failure",
    });
  }
  try {
    const summary = JSON.parse(read(summaryPath, "utf8"));
    const result = evaluateCoverageSummary(summary, profile);
    if (!result.includesCoreProject) {
      return Object.freeze({ ...result, status: "fail", reason: "core-project-missing" });
    }
    return result;
  } catch {
    return Object.freeze({
      schemaVersion: QUALITY_POLICY_SCHEMA_VERSION,
      check: "coverage",
      profile,
      status: "fail",
      reason: "invalid-summary",
    });
  }
}

function validateRelativePath(value) {
  if (
    typeof value !== "string" || value.length === 0 || value.includes("\\") ||
    value.startsWith("/") || value.split("/").includes("..") ||
    !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    throw new TypeError("Fixture retention path is invalid.");
  }
  return value;
}

export function parseFixtureRetentionManifest(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.roots) || !Array.isArray(value.entries)) {
    throw new TypeError("Fixture retention manifest is invalid.");
  }
  const roots = value.roots.map(validateRelativePath);
  if (roots.length === 0 || new Set(roots).size !== roots.length || roots.join() !== [...roots].sort().join()) {
    throw new TypeError("Fixture retention roots must be unique and sorted.");
  }
  const entries = value.entries.map((entry) => {
    if (!isRecord(entry)) throw new TypeError("Fixture retention entry is invalid.");
    const path = validateRelativePath(entry.path);
    if (
      typeof entry.kind !== "string" || !/^[a-z0-9-]+$/u.test(entry.kind) ||
      typeof entry.owner !== "string" || !/^[A-Za-z0-9/-]+$/u.test(entry.owner) ||
      (entry.mode !== "binary" && entry.mode !== "text-lf") ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
      typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(entry.sha256)
    ) {
      throw new TypeError("Fixture retention entry is invalid.");
    }
    if (!roots.some((root) => path.startsWith(`${root}/`))) {
      throw new TypeError("Fixture retention entry is outside declared roots.");
    }
    return Object.freeze({
      path,
      kind: entry.kind,
      owner: entry.owner,
      mode: entry.mode,
      bytes: entry.bytes,
      sha256: entry.sha256,
    });
  });
  const paths = entries.map(({ path }) => path);
  if (entries.length === 0 || new Set(paths).size !== paths.length || paths.join() !== [...paths].sort().join()) {
    throw new TypeError("Fixture retention entries must be unique and sorted.");
  }
  return Object.freeze({ schemaVersion: 1, roots: Object.freeze(roots), entries: Object.freeze(entries) });
}

export function retainedContentIdentity(mode, fileBytes) {
  if ((mode !== "binary" && mode !== "text-lf") || !Buffer.isBuffer(fileBytes)) {
    throw new TypeError("Retained content identity input is invalid.");
  }
  const canonicalBytes = mode === "text-lf"
    ? Buffer.from(fileBytes.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8")
    : fileBytes;
  return Object.freeze({
    bytes: canonicalBytes.byteLength,
    sha256: createHash("sha256").update(canonicalBytes).digest("hex"),
  });
}

function collectPhysicalFiles(directory, cwd, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new TypeError("Fixture retention roots cannot contain symlinks.");
    if (entry.isDirectory()) collectPhysicalFiles(absolutePath, cwd, output);
    else if (entry.isFile()) output.push(relative(cwd, absolutePath).split(sep).join("/"));
    else throw new TypeError("Fixture retention roots must contain only regular files.");
  }
  return output;
}

export function captureFixtureInventory(manifest, options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const spawn = options.spawnSync ?? spawnSync;
  const statFile = options.lstatSync ?? lstatSync;
  const discovered = manifest.roots.flatMap((root) => {
    const absoluteRoot = resolve(cwd, root);
    const rootStat = statFile(absoluteRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new TypeError("Fixture retention root must be a physical directory.");
    }
    return collectPhysicalFiles(absoluteRoot, cwd);
  }).sort();
  const paths = manifest.entries.map(({ path }) => path);
  const trackedResult = spawn("git", ["ls-files", "--", ...paths], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (trackedResult.error || trackedResult.status !== 0) throw new TypeError("Tracked fixture inventory is unavailable.");
  const tracked = new Set(String(trackedResult.stdout).split(/\r?\n/u).filter(Boolean).map((path) => path.replaceAll("\\", "/")));
  const records = {};
  for (const entry of manifest.entries) {
    const absolutePath = resolve(cwd, entry.path);
    const stat = statFile(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError("Retained fixture must be a regular tracked file.");
    const fileBytes = readFileSync(absolutePath);
    const identity = retainedContentIdentity(entry.mode, fileBytes);
    records[entry.path] = Object.freeze({
      tracked: tracked.has(entry.path),
      ...identity,
    });
  }
  return Object.freeze({ discovered: Object.freeze(discovered), records: Object.freeze(records) });
}

export function evaluateFixtureInventory(manifest, inventory) {
  const expectedPaths = manifest.entries.map(({ path }) => path);
  const expected = new Set(expectedPaths);
  const discovered = new Set(inventory.discovered);
  const missing = expectedPaths.filter((path) => !discovered.has(path));
  const unmanifested = inventory.discovered.filter((path) => !expected.has(path));
  const untracked = [];
  const drifted = [];
  for (const entry of manifest.entries) {
    const record = inventory.records[entry.path];
    if (!record?.tracked) untracked.push(entry.path);
    if (record && (record.bytes !== entry.bytes || record.sha256 !== entry.sha256)) drifted.push(entry.path);
  }
  return Object.freeze({
    schemaVersion: QUALITY_POLICY_SCHEMA_VERSION,
    check: "fixtures",
    status: missing.length + unmanifested.length + untracked.length + drifted.length === 0 ? "pass" : "fail",
    retainedCount: manifest.entries.length,
    rootCount: manifest.roots.length,
    missing: Object.freeze(missing),
    unmanifested: Object.freeze(unmanifested),
    untracked: Object.freeze(untracked),
    drifted: Object.freeze(drifted),
  });
}

export function runFixtureRetentionCheck(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  try {
    const manifestPath = resolve(cwd, FIXTURE_RETENTION_MANIFEST_PATH);
    const read = options.readFileSync ?? readFileSync;
    const manifest = parseFixtureRetentionManifest(JSON.parse(read(manifestPath, "utf8")));
    return evaluateFixtureInventory(manifest, captureFixtureInventory(manifest, {
      cwd,
      spawnSync: options.spawnSync,
    }));
  } catch {
    return Object.freeze({
      schemaVersion: QUALITY_POLICY_SCHEMA_VERSION,
      check: "fixtures",
      status: "fail",
      reason: "invalid-or-unavailable-inventory",
    });
  }
}

export function parseQualityArguments(args) {
  const [check, ...rest] = args;
  if (check === "fixtures") {
    if (rest.length !== 0) throw new TypeError("Fixtures check accepts no arguments.");
    return Object.freeze({ check, profile: null });
  }
  if (check !== "coverage") throw new TypeError("Unknown quality policy check.");
  if (rest.length === 0) return Object.freeze({ check, profile: "ratchet" });
  if (rest.length !== 2 || rest[0] !== "--profile" || !Object.hasOwn(COVERAGE_THRESHOLDS, rest[1])) {
    throw new TypeError("Coverage profile is invalid.");
  }
  return Object.freeze({ check, profile: rest[1] });
}

export function runQualityPolicyCli(args = process.argv.slice(2), io = {}, dependencies = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let parsed;
  try {
    parsed = parseQualityArguments(args);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : "Invalid quality policy arguments."}\n`);
    return 2;
  }
  const result = parsed.check === "coverage"
    ? runCoverageCheck(parsed.profile, dependencies)
    : runFixtureRetentionCheck(dependencies);
  stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "pass" ? 0 : 1;
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = runQualityPolicyCli();
