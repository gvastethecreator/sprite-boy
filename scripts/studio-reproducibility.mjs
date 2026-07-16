/**
 * Verify that the checked-in package manifest and Bun lockfile are a
 * reproducible pair.
 *
 * The exported contract/evidence evaluators are deliberately pure.  The CLI
 * is the only path that touches the filesystem or starts Bun, and it emits a
 * small, data-only JSON report so process output cannot leak paths or package
 * manager diagnostics into CI logs.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolveBunExecutable } from "./studio-gates.mjs";

export const REPRO_SCHEMA_VERSION = 1;
export const REPRO_BUN_VERSION = "1.3.14";
export const REPRO_NODE_MAJOR = 24;
export const REPRO_TIMEOUT_MS = 120_000;
export const EXPECTED_OVERRIDES = Object.freeze({
  protobufjs: "7.6.5",
  undici: "7.28.0",
  ws: "8.21.1",
});
export const REPRO_INSTALL_ARGV = Object.freeze([
  "install",
  "--frozen-lockfile",
  "--lockfile-only",
  "--ignore-scripts",
]);
export const GITATTRIBUTES_POLICY = "bun.lock text eol=lf";

export const WORKFLOW_ACTIONS = Object.freeze([
  Object.freeze({
    name: "actions/checkout",
    ref: "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
    version: "v6.0.2",
  }),
  Object.freeze({
    name: "oven-sh/setup-bun",
    ref: "0c5077e51419868618aeaa5fe8019c62421857d6",
    version: "v2.2.0",
  }),
  Object.freeze({
    name: "actions/setup-node",
    ref: "395ad3262231945c25e8478fd5baf05154b1d79f",
    version: "v6.1.0",
  }),
]);

const EXPECTED_ACTION_USES = Object.freeze(
  WORKFLOW_ACTIONS.map(({ name, ref }) => `${name}@${ref}`),
);

function freezeResult(result) {
  if (result && typeof result === "object" && !Object.isFrozen(result)) {
    if (Array.isArray(result.errors) && !Object.isFrozen(result.errors)) Object.freeze(result.errors);
    if (Array.isArray(result.actions) && !Object.isFrozen(result.actions)) Object.freeze(result.actions);
    Object.freeze(result);
  }
  return result;
}

function asObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseJsonDocument(value) {
  if (typeof value === "string") {
    try {
      return { value: JSON.parse(value), error: null };
    } catch {
      return { value: null, error: "invalid-json" };
    }
  }
  return { value, error: null };
}

function supportsPinnedNode(value) {
  return value === ">=24.0.0";
}

function isPlainStringMap(value) {
  return asObject(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function sortedMap(value) {
  if (!isPlainStringMap(value)) return null;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

function mapsEqual(left, right) {
  const sortedLeft = sortedMap(left);
  const sortedRight = sortedMap(right);
  return sortedLeft !== null && sortedRight !== null
    && JSON.stringify(sortedLeft) === JSON.stringify(sortedRight);
}

class LockHeaderParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  skipSpace() {
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (/\s/u.test(character)) {
        this.index += 1;
        continue;
      }
      if (this.source.startsWith("//", this.index)) {
        const end = this.source.indexOf("\n", this.index + 2);
        this.index = end < 0 ? this.source.length : end + 1;
        continue;
      }
      if (this.source.startsWith("/*", this.index)) {
        const end = this.source.indexOf("*/", this.index + 2);
        if (end < 0) throw new TypeError("unterminated comment");
        this.index = end + 2;
        continue;
      }
      break;
    }
  }

  parseString() {
    const start = this.index;
    const quote = this.source[this.index];
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      this.index += 1;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        return JSON.parse(this.source.slice(start, this.index));
      }
    }
    throw new TypeError("unterminated string");
  }

  parseIdentifier() {
    const start = this.index;
    while (this.index < this.source.length && /[A-Za-z0-9_$./@-]/u.test(this.source[this.index])) {
      this.index += 1;
    }
    if (this.index === start) throw new TypeError("expected identifier");
    return this.source.slice(start, this.index);
  }

  parseValue() {
    this.skipSpace();
    const character = this.source[this.index];
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"' || character === "'") return this.parseString();
    const token = this.parseIdentifier();
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(token)) return Number(token);
    throw new TypeError("unsupported scalar");
  }

  parseObject() {
    const result = Object.create(null);
    this.index += 1;
    this.skipSpace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      this.skipSpace();
      const key = this.source[this.index] === '"' || this.source[this.index] === "'"
        ? this.parseString()
        : this.parseIdentifier();
      if (Object.hasOwn(result, key)) throw new TypeError("duplicate object key");
      this.skipSpace();
      if (this.source[this.index] !== ":") throw new TypeError("expected object colon");
      this.index += 1;
      result[key] = this.parseValue();
      this.skipSpace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") throw new TypeError("expected object comma");
      this.index += 1;
      this.skipSpace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
    }
    throw new TypeError("unterminated object");
  }

  parseArray() {
    const result = [];
    this.index += 1;
    this.skipSpace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      result.push(this.parseValue());
      this.skipSpace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") throw new TypeError("expected array comma");
      this.index += 1;
      this.skipSpace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
    }
    throw new TypeError("unterminated array");
  }

  parseDocument() {
    this.skipSpace();
    const result = this.parseValue();
    this.skipSpace();
    if (this.index !== this.source.length) throw new TypeError("trailing lock content");
    return result;
  }
}

function parseLockDocument(lockSource) {
  if (typeof lockSource !== "string") return { value: null, error: "lock-not-string" };
  try {
    const value = new LockHeaderParser(lockSource).parseDocument();
    return { value, error: null };
  } catch {
    return { value: null, error: "malformed-lock" };
  }
}

/** Validate the package manager and Node engine policy without touching disk. */
export function evaluatePackageContract(packageDocument) {
  const parsed = parseJsonDocument(packageDocument);
  const packageJson = asObject(parsed.value);
  const errors = [];

  if (parsed.error) errors.push(parsed.error);
  if (!packageJson) {
    errors.push("package-not-object");
  } else {
    if (packageJson.packageManager !== `bun@${REPRO_BUN_VERSION}`) {
      errors.push("package-manager-mismatch");
    }
    const engines = asObject(packageJson.engines);
    if (!engines || !supportsPinnedNode(engines.node)) {
      errors.push("node-engine-mismatch");
    }
    if (!mapsEqual(packageJson.overrides, EXPECTED_OVERRIDES)) {
      errors.push("overrides-mismatch");
    }
  }

  return freezeResult({
    schemaVersion: REPRO_SCHEMA_VERSION,
    valid: errors.length === 0,
    packageManager: packageJson?.packageManager ?? null,
    nodeEngine: asObject(packageJson?.engines)?.node ?? null,
    overrides: sortedMap(packageJson?.overrides),
    errors,
  });
}

/** Require the checkout policy that keeps Bun's lock bytes stable on Windows. */
export function evaluateGitAttributesContract(attributesSource) {
  const source = typeof attributesSource === "string" ? attributesSource : "";
  const lines = source.split(/\r?\n/u).map((line) => line.trim());
  const policyLines = lines.filter((line) => line && !line.startsWith("#") && /^bun\.lock(?:\s|$)/u.test(line));
  const valid = policyLines.length > 0 && policyLines.every((line) => line === GITATTRIBUTES_POLICY);
  return freezeResult({
    schemaVersion: REPRO_SCHEMA_VERSION,
    valid,
    policy: valid ? GITATTRIBUTES_POLICY : null,
    errors: valid ? [] : ["gitattributes-lock-eol-mismatch"],
  });
}

/** Compare Bun's generated root metadata with the package manifest exactly. */
export function evaluateLockContract(packageDocument, lockSource) {
  const parsedPackage = parseJsonDocument(packageDocument);
  const packageJson = asObject(parsedPackage.value);
  const parsedLock = parseLockDocument(lockSource);
  const lock = asObject(parsedLock.value);
  const workspace = asObject(asObject(lock?.workspaces)?.[""]);
  const errors = [];
  const packageDependencies = asObject(packageJson?.dependencies);
  const packageDevDependencies = asObject(packageJson?.devDependencies);
  const packageOverrides = asObject(packageJson?.overrides);
  const lockDependencies = asObject(workspace?.dependencies);
  const lockDevDependencies = asObject(workspace?.devDependencies);
  const lockOverrides = asObject(lock?.overrides);

  if (parsedPackage.error || !packageJson) errors.push("package-invalid");
  if (parsedLock.error) errors.push(parsedLock.error);
  if (!workspace) errors.push("lock-workspace-missing");
  if (!packageDependencies || !lockDependencies || !mapsEqual(packageDependencies, lockDependencies)) {
    errors.push("dependencies-mismatch");
  }
  if (!packageDevDependencies || !lockDevDependencies || !mapsEqual(packageDevDependencies, lockDevDependencies)) {
    errors.push("dev-dependencies-mismatch");
  }
  if (!packageOverrides || !lockOverrides || !mapsEqual(packageOverrides, lockOverrides)) {
    errors.push("overrides-mismatch");
  }

  return freezeResult({
    schemaVersion: REPRO_SCHEMA_VERSION,
    valid: errors.length === 0,
    errors,
    root: {
      dependencies: sortedMap(lockDependencies),
      devDependencies: sortedMap(lockDevDependencies),
      overrides: sortedMap(lockOverrides),
    },
  });
}

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some((entry) => containsForbiddenKey(entry));
  const object = asObject(value);
  if (!object) return false;
  return Object.entries(object).some(([key, entry]) => key === "continue-on-error" || containsForbiddenKey(entry));
}

function workflowParser(options) {
  if (typeof options === "function") return options;
  if (options && typeof options.parseYaml === "function") return options.parseYaml;
  if (options && typeof options.yamlParser === "function") return options.yamlParser;
  if (options && typeof options.parser === "function") return options.parser;
  if (options && Object.hasOwn(options, "parseYaml")) return options.parseYaml;
  return globalThis.Bun?.YAML?.parse;
}

function exactRunStep(steps, expected) {
  return steps.findIndex((step) => typeof step?.run === "string" && step.run.trim() === expected);
}

function hasExactKeys(value, expected) {
  const object = asObject(value);
  if (!object) return false;
  const actual = Object.keys(object).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function hasExactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

/** Validate the workflow by parsing YAML, never by trusting matching text. */
export function evaluateWorkflowContract(workflowSource, options = {}) {
  const errors = [];
  const source = typeof workflowSource === "string" ? workflowSource : "";
  if (!source.trim()) errors.push("workflow-empty");
  const parseYaml = workflowParser(options);
  let document = null;
  if (typeof parseYaml !== "function") {
    errors.push("yaml-parser-unavailable");
  } else {
    try {
      document = parseYaml(source);
    } catch {
      errors.push("malformed-workflow");
    }
  }
  const workflow = asObject(document);
  const permissions = asObject(workflow?.permissions);
  const concurrency = asObject(workflow?.concurrency);
  const jobs = asObject(workflow?.jobs);
  const job = asObject(jobs?.["studio-quality"]);
  const steps = Array.isArray(job?.steps) ? job.steps : [];

  if (!workflow) errors.push("workflow-not-object");
  if (typeof workflow?.name !== "string" || !workflow.name.trim()) errors.push("workflow-name-missing");
  const triggers = asObject(workflow?.on);
  if (!triggers || !Object.hasOwn(workflow, "on")) {
    errors.push("workflow-trigger-missing");
  } else if (
    !hasExactKeys(triggers, ["push", "pull_request"])
    || !hasExactKeys(triggers.push, ["branches"])
    || !hasExactArray(triggers.push?.branches, ["main"])
    || triggers.pull_request !== null
  ) {
    errors.push("workflow-trigger-mismatch");
  }
  if (!permissions || Object.keys(permissions).length !== 1 || permissions.contents !== "read") {
    errors.push("permissions-mismatch");
  }
  const expectedConcurrencyGroup = "studio-quality-${{ github.workflow }}-${{ github.ref }}";
  if (!concurrency || typeof concurrency.group !== "string" || !concurrency.group.trim()) {
    errors.push("concurrency-group-missing");
  }
  if (
    !concurrency
    || !hasExactKeys(concurrency, ["group", "cancel-in-progress"])
    || concurrency.group !== expectedConcurrencyGroup
  ) errors.push("concurrency-mismatch");
  if (concurrency?.["cancel-in-progress"] !== true) errors.push("concurrency-cancel-missing");
  if (!jobs || Object.keys(jobs).length !== 1 || !job) errors.push("job-missing");
  if (job?.["runs-on"] !== "ubuntu-24.04") errors.push("runner-mismatch");
  if (job?.["timeout-minutes"] !== 30) errors.push("timeout-mismatch");
  if (!Array.isArray(job?.steps) || steps.length !== 8) errors.push("steps-mismatch");

  const [checkoutStep, bunStep, nodeStep, chromeStep, installStep, auditStep, allStep, e2eStep] = steps;
  const orderedStepsMatch = Boolean(
    checkoutStep?.name === "Check out source"
      && checkoutStep.uses === EXPECTED_ACTION_USES[0]
      && hasExactKeys(checkoutStep, ["name", "uses", "with"])
      && hasExactKeys(checkoutStep.with, ["persist-credentials"])
      && checkoutStep.with["persist-credentials"] === false
      && bunStep?.name === "Set up Bun"
      && bunStep.uses === EXPECTED_ACTION_USES[1]
      && hasExactKeys(bunStep, ["name", "uses", "with"])
      && hasExactKeys(bunStep.with, ["bun-version"])
      && bunStep.with["bun-version"] === "1.3.14"
      && nodeStep?.name === "Set up Node.js"
      && nodeStep.uses === EXPECTED_ACTION_USES[2]
      && hasExactKeys(nodeStep, ["name", "uses", "with"])
      && hasExactKeys(nodeStep.with, ["node-version"])
      && nodeStep.with["node-version"] === "24.18.0"
      && chromeStep?.name === "Verify Chrome executable"
      && hasExactKeys(chromeStep, ["name", "shell", "run"])
      && chromeStep.shell === "bash"
      && typeof chromeStep.run === "string"
      && chromeStep.run.includes("command -v google-chrome")
      && chromeStep.run.includes("STUDIO_CHROME_PATH")
      && installStep?.name === "Install frozen dependencies"
      && hasExactKeys(installStep, ["name", "run"])
      && installStep.run === "bun install --frozen-lockfile --ignore-scripts"
      && auditStep?.name === "Audit high-severity vulnerabilities"
      && hasExactKeys(auditStep, ["name", "run"])
      && auditStep.run === "bun audit --audit-level=high"
      && allStep?.name === "Run all studio gates"
      && hasExactKeys(allStep, ["name", "run"])
      && allStep.run === "bun scripts/studio-gates.mjs --gate all"
      && e2eStep?.name === "Run production browser smoke gate"
      && hasExactKeys(e2eStep, ["name", "run"])
      && e2eStep.run === "bun scripts/studio-gates.mjs --gate e2e"
  );
  if (!orderedStepsMatch) errors.push("steps-order-mismatch");

  const actionUses = steps.filter((step) => typeof step?.uses === "string").map((step) => step.uses);
  if (actionUses.length !== EXPECTED_ACTION_USES.length || actionUses.some((value, index) => value !== EXPECTED_ACTION_USES[index])) {
    errors.push("actions-mismatch");
  }
  for (const [index, expected] of WORKFLOW_ACTIONS.entries()) {
    const step = steps.find((candidate) => candidate?.uses === `${expected.name}@${expected.ref}`);
    if (!step) errors.push(`action-missing:${expected.name}`);
    if (index === 0 && step?.with?.["persist-credentials"] !== false) errors.push("persist-credentials-mismatch");
  }

  if (bunStep?.with?.["bun-version"] !== "1.3.14") errors.push("bun-version-mismatch");
  if (nodeStep?.with?.["node-version"] !== "24.18.0") errors.push("node-version-mismatch");

  if (!chromeStep || typeof chromeStep.run !== "string" || !chromeStep.run.includes("STUDIO_CHROME_PATH")) {
    errors.push("chrome-check-missing");
  }
  const installIndex = exactRunStep(steps, "bun install --frozen-lockfile --ignore-scripts");
  const auditIndex = exactRunStep(steps, "bun audit --audit-level=high");
  const allIndex = exactRunStep(steps, "bun scripts/studio-gates.mjs --gate all");
  const e2eIndex = exactRunStep(steps, "bun scripts/studio-gates.mjs --gate e2e");
  if (installIndex < 0) errors.push("frozen-install-missing");
  if (auditIndex < 0) errors.push("audit-missing");
  if (allIndex < 0) errors.push("all-gate-missing");
  if (e2eIndex < 0) errors.push("e2e-gate-missing");
  if ([installIndex, auditIndex, allIndex, e2eIndex].every((index) => index >= 0)
    && !(installIndex < auditIndex && auditIndex < allIndex && allIndex < e2eIndex)) {
    errors.push("gate-order-mismatch");
  }
  if (containsForbiddenKey(document)) errors.push("continue-on-error-forbidden");

  return freezeResult({
    schemaVersion: REPRO_SCHEMA_VERSION,
    valid: errors.length === 0,
    actions: actionUses,
    errors,
  });
}

function isInteger(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function expectedExecutionEvidence(execution) {
  return asObject(execution)
    && execution.command === "bun"
    && Array.isArray(execution.argv)
    && execution.argv.length === REPRO_INSTALL_ARGV.length
    && execution.argv.every((value, index) => value === REPRO_INSTALL_ARGV[index])
    && execution.shell === false
    && isInteger(execution.timeoutMs)
    && execution.timeoutMs >= 1
    && execution.timeoutMs <= REPRO_TIMEOUT_MS;
}

function validCommandEvidence(value, expectedStatus) {
  return asObject(value)
    && value.status === expectedStatus
    && isInteger(value.exitCode)
    && (expectedStatus === "passed" ? value.exitCode === 0 : value.exitCode !== 0)
    && value.lockUnchanged === true
    && value.lockDigestBefore === value.lockDigestAfter;
}

/** Validate probe evidence strictly, rejecting malformed or false-green data. */
export function evaluateReproducibilityEvidence(evidence) {
  const value = asObject(evidence);
  const errors = [];
  if (!value) {
    errors.push("evidence-not-object");
  } else {
    const packageContract = asObject(value.packageContract);
    const gitattributesContract = asObject(value.gitattributesContract);
    const lockContract = asObject(value.lockContract);
    const workflowContract = asObject(value.workflowContract);
    if (!packageContract || packageContract.valid !== true) errors.push("package-contract-failed");
    if (!gitattributesContract || gitattributesContract.valid !== true) errors.push("gitattributes-contract-failed");
    if (!lockContract || lockContract.valid !== true) errors.push("lock-contract-failed");
    if (!workflowContract || workflowContract.valid !== true) errors.push("workflow-contract-failed");
    if (!validCommandEvidence(value.baseline, "passed")) errors.push("baseline-failed");
    if (!validCommandEvidence(value.drift, "failed")) errors.push("drift-not-rejected");
    if (!expectedExecutionEvidence(value.execution)) errors.push("execution-contract-failed");
    if (!asObject(value.cleanup) || value.cleanup.status !== "passed") errors.push("cleanup-failed");
  }
  return freezeResult({
    schemaVersion: REPRO_SCHEMA_VERSION,
    valid: errors.length === 0,
    errors,
  });
}

// Short aliases keep the pure evaluators convenient for callers and tests.
export const evaluatePackageManifest = evaluatePackageContract;
export const evaluateWorkflow = evaluateWorkflowContract;
export const evaluateEvidence = evaluateReproducibilityEvidence;
export const validatePackageContract = evaluatePackageContract;
export const validateLockContract = evaluateLockContract;
export const validateWorkflowContract = evaluateWorkflowContract;
export const validateEvidence = evaluateReproducibilityEvidence;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readDigest(readFile, filePath) {
  return digest(readFile(filePath));
}

function commandOutcome(spawn, cwd, timeoutMs, bunExecutable) {
  try {
    const result = spawn(bunExecutable, [...REPRO_INSTALL_ARGV], {
      cwd,
      env: process.env,
      shell: false,
      stdio: "pipe",
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (result?.error) {
      return {
        status: "failed",
        exitCode: null,
        reason: result.error.code === "ETIMEDOUT" ? "timeout" : "execution-failure",
      };
    }
    const exitCode = isInteger(result?.status) ? result.status : null;
    return {
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      reason: exitCode === 0 ? null : "non-zero-exit",
    };
  } catch {
    return { status: "failed", exitCode: null, reason: "execution-failure" };
  }
}

function commandEvidence(outcome, digestBefore, digestAfter) {
  const lockUnchanged = typeof digestBefore === "string" && digestBefore === digestAfter;
  const status = outcome.status === "passed" && lockUnchanged ? "passed" : "failed";
  const reason = !lockUnchanged ? "lock-mutated" : outcome.reason;
  return {
    status,
    exitCode: outcome.exitCode,
    reason,
    lockUnchanged,
    lockDigestBefore: digestBefore,
    lockDigestAfter: digestAfter,
  };
}

function normalizeFs(options) {
  const injected = asObject(options.fs) ?? {};
  return {
    copyFile: injected.copyFileSync ?? injected.copyFile ?? copyFileSync,
    mkdtemp: injected.mkdtempSync ?? injected.mkdtemp ?? mkdtempSync,
    readFile: injected.readFileSync ?? injected.readFile ?? readFileSync,
    remove: injected.rmSync ?? injected.remove ?? rmSync,
    writeFile: injected.writeFileSync ?? injected.writeFile ?? writeFileSync,
  };
}

function sanitizeRoot(root) {
  if (typeof root !== "string" || root.length === 0) return process.cwd();
  return isAbsolute(root) ? root : resolve(root);
}

function isSafeTemporaryRoot(value) {
  if (typeof value !== "string" || !value) return false;
  const base = resolve(tmpdir());
  const candidate = resolve(value);
  const child = relative(base, candidate);
  return child !== ""
    && !child.startsWith("..")
    && !isAbsolute(child)
    && basename(candidate).startsWith("sprite-boy-repro-");
}

function initialEvidence(packageContract, gitattributesContract, lockContract, workflowContract, timeoutMs) {
  return {
    packageContract,
    gitattributesContract,
    lockContract,
    workflowContract,
    baseline: null,
    drift: null,
    execution: {
      command: "bun",
      argv: [...REPRO_INSTALL_ARGV],
      shell: false,
      timeoutMs,
    },
    cleanup: { status: "not-run" },
  };
}

/**
 * Execute the two frozen-install probes in an isolated temporary workspace.
 * `spawnSync` and filesystem functions are injectable to make failure paths
 * deterministic in tests without changing the production command.
 */
export function runReproducibilityProbe(options = {}) {
  const root = sanitizeRoot(options.root);
  const timeoutMs = isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? Math.min(options.timeoutMs, REPRO_TIMEOUT_MS)
    : REPRO_TIMEOUT_MS;
  const spawn = options.spawnSync ?? options.spawn ?? spawnSync;
  const fs = normalizeFs(options);
  let bunExecutable;
  let runtimeError = null;
  try {
    bunExecutable = resolveBunExecutable(options);
  } catch {
    runtimeError = "bun-runtime-mismatch";
  }
  const packagePath = join(root, "package.json");
  const gitattributesPath = join(root, ".gitattributes");
  const lockPath = join(root, "bun.lock");
  const workflowPath = join(root, ".github", "workflows", "studio-quality.yml");
  let packageContract;
  let gitattributesContract;
  let lockContract;
  let workflowContract;
  let packageSource = null;
  let lockSource = null;
  try {
    packageSource = fs.readFile(packagePath, "utf8");
    packageContract = evaluatePackageContract(packageSource);
  } catch {
    packageContract = evaluatePackageContract(null);
    packageContract = freezeResult({ ...packageContract, errors: [...packageContract.errors, "package-read-failed"], valid: false });
  }
  try {
    gitattributesContract = evaluateGitAttributesContract(fs.readFile(gitattributesPath, "utf8"));
  } catch {
    gitattributesContract = evaluateGitAttributesContract(null);
    gitattributesContract = freezeResult({ ...gitattributesContract, errors: [...gitattributesContract.errors, "gitattributes-read-failed"], valid: false });
  }
  try {
    const workflowOptions = Object.hasOwn(options, "parseYaml") || Object.hasOwn(options, "yamlParser") || Object.hasOwn(options, "parser")
      ? options
      : {};
    workflowContract = evaluateWorkflowContract(fs.readFile(workflowPath, "utf8"), workflowOptions);
  } catch {
    const workflowOptions = Object.hasOwn(options, "parseYaml") || Object.hasOwn(options, "yamlParser") || Object.hasOwn(options, "parser")
      ? options
      : {};
    workflowContract = evaluateWorkflowContract("", workflowOptions);
    workflowContract = freezeResult({ ...workflowContract, errors: [...workflowContract.errors, "workflow-read-failed"], valid: false });
  }
  try {
    lockSource = fs.readFile(lockPath, "utf8");
    lockContract = evaluateLockContract(packageSource, lockSource);
  } catch {
    lockContract = evaluateLockContract(packageSource, null);
    lockContract = freezeResult({ ...lockContract, errors: [...lockContract.errors, "lock-read-failed"], valid: false });
  }

  const evidence = initialEvidence(packageContract, gitattributesContract, lockContract, workflowContract, timeoutMs);
  let temporaryRoot = null;
  let executionError = runtimeError;
  try {
    if (runtimeError) throw new Error(runtimeError);
    temporaryRoot = fs.mkdtemp(join(tmpdir(), "sprite-boy-repro-"));
    fs.copyFile(packagePath, join(temporaryRoot, "package.json"));
    fs.copyFile(lockPath, join(temporaryRoot, "bun.lock"));

    const temporaryLock = join(temporaryRoot, "bun.lock");
    let baselineBefore;
    try {
      baselineBefore = readDigest(fs.readFile, temporaryLock);
    } catch {
      executionError = "lock-read-failure";
    }
    if (!executionError) {
      const baselineOutcome = commandOutcome(spawn, temporaryRoot, timeoutMs, bunExecutable);
      let baselineAfter;
      try {
        baselineAfter = readDigest(fs.readFile, temporaryLock);
      } catch {
        baselineAfter = null;
      }
      evidence.baseline = commandEvidence(baselineOutcome, baselineBefore, baselineAfter);
    }

    const temporaryPackage = join(temporaryRoot, "package.json");
    try {
      const packageJson = JSON.parse(fs.readFile(temporaryPackage, "utf8"));
      const dependencyGroup = asObject(packageJson.dependencies) ?? asObject(packageJson.devDependencies);
      const dependencyName = dependencyGroup ? Object.keys(dependencyGroup)[0] : null;
      if (!dependencyName) throw new Error("no dependency");
      dependencyGroup[dependencyName] = "0.0.0-invalid-repro-range";
      fs.writeFile(temporaryPackage, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    } catch {
      executionError = executionError ?? "manifest-write-failure";
    }

    if (!executionError || evidence.baseline) {
      let driftBefore;
      try {
        driftBefore = readDigest(fs.readFile, temporaryLock);
      } catch {
        driftBefore = null;
      }
      const driftOutcome = commandOutcome(spawn, temporaryRoot, timeoutMs, bunExecutable);
      let driftAfter;
      try {
        driftAfter = readDigest(fs.readFile, temporaryLock);
      } catch {
        driftAfter = null;
      }
      evidence.drift = commandEvidence(driftOutcome, driftBefore, driftAfter);
    }
  } catch {
    executionError = executionError ?? "probe-setup-failure";
  } finally {
    if (temporaryRoot) {
      if (!isSafeTemporaryRoot(temporaryRoot)) {
        evidence.cleanup = { status: "failed", reason: "cleanup-boundary" };
      } else {
        try {
          fs.remove(temporaryRoot, { recursive: true, force: true });
          evidence.cleanup = { status: "passed" };
        } catch {
          evidence.cleanup = { status: "failed", reason: "cleanup-failure" };
        }
      }
    } else {
      evidence.cleanup = { status: "failed", reason: "cleanup-not-started" };
    }
  }

  if (executionError) {
    evidence.execution = { ...evidence.execution, error: executionError };
  }
  const assessment = evaluateReproducibilityEvidence(evidence);
  const errors = [...assessment.errors];
  if (executionError) errors.push(executionError);
  return Object.freeze({
    schemaVersion: REPRO_SCHEMA_VERSION,
    status: assessment.valid && !executionError ? "passed" : "failed",
    packageContract,
    gitattributesContract,
    lockContract,
    workflowContract,
    evidence,
    errors: [...new Set(errors)],
  });
}

export const runReproducibility = runReproducibilityProbe;

/** Parse CLI arguments without touching the filesystem. */
export function parseReproducibilityArguments(args = []) {
  if (!Array.isArray(args)) throw new TypeError("Reproducibility arguments must be an array.");
  let root = process.cwd();
  let timeoutMs = REPRO_TIMEOUT_MS;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (typeof argument !== "string") throw new TypeError("Invalid reproducibility argument.");
    if (argument === "--root" || argument.startsWith("--root=")) {
      if (seen.has("--root")) throw new TypeError("Duplicate argument: --root");
      seen.add("--root");
      const value = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : args[++index];
      if (typeof value !== "string" || !value || value.startsWith("--")) throw new TypeError("--root requires a path");
      root = value;
    } else if (argument === "--timeout-ms" || argument.startsWith("--timeout-ms=")) {
      if (seen.has("--timeout-ms")) throw new TypeError("Duplicate argument: --timeout-ms");
      seen.add("--timeout-ms");
      const value = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : args[++index];
      if (typeof value !== "string" || !/^\d+$/u.test(value)) throw new TypeError("--timeout-ms requires a positive integer");
      timeoutMs = Number(value);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REPRO_TIMEOUT_MS) {
        throw new TypeError(`--timeout-ms must be between 1 and ${REPRO_TIMEOUT_MS}`);
      }
    } else {
      throw new TypeError("Unknown reproducibility argument.");
    }
  }
  return Object.freeze({ root, timeoutMs });
}

/** Run the CLI and return a process exit code; imports never run this path. */
export function runReproducibilityCli(args = process.argv.slice(2), io = {}, dependencies = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const options = parseReproducibilityArguments(args);
    const report = runReproducibilityProbe({ ...options, ...dependencies });
    stdout.write(`${JSON.stringify(report)}\n`);
    return report.status === "passed" ? 0 : 1;
  } catch (error) {
    stderr.write(`studio-reproducibility: ${error instanceof Error ? error.message : "execution failure"}\n`);
    return 1;
  }
}

export const parseArguments = parseReproducibilityArguments;
export const runCli = runReproducibilityCli;

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = runReproducibilityCli();
