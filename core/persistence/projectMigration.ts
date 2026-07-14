export type ProjectMigrationStatus = "unchanged" | "migrated" | "needs-input";

export type ProjectMigrationIssue = ProjectMigrationIssueBase & (
  | {
      category: "change";
      severity: "info";
      blocking: false;
    }
  | {
      category: "warning";
      severity: "warning";
      blocking: false;
    }
  | {
      category: "loss";
      severity: "warning" | "error";
      blocking: boolean;
    }
  | {
      category: "needs-relink";
      severity: "error";
      blocking: true;
      sourceRef: string;
    }
  | {
      category: "ambiguity";
      severity: "error";
      blocking: true;
      choices: readonly ProjectMigrationChoice[];
    }
);

interface ProjectMigrationIssueBase {
  code: string;
  path: string;
  message: string;
  entityId?: string;
}

export interface ProjectMigrationChoice {
  id: string;
  label: string;
}

export interface ProjectMigrationStepDescriptor {
  id: string;
  fromVersion: number;
  toVersion: number;
}

export type ProjectMigrationStepResult =
  | {
      status: "completed";
      document: unknown;
      issues?: readonly ProjectMigrationIssue[];
    }
  | {
      status: "needs-input";
      issues: readonly ProjectMigrationIssue[];
    };

export interface ProjectMigrationStep<TContext = undefined>
  extends ProjectMigrationStepDescriptor {
  migrate(
    document: unknown,
    context: TContext,
  ): ProjectMigrationStepResult | PromiseLike<ProjectMigrationStepResult>;
}

export interface ProjectMigrationRequest<TContext = undefined> {
  sourceVersion: number;
  targetVersion: number;
  context: TContext;
  signal?: AbortSignal;
}

export interface ProjectMigrationReport {
  status: ProjectMigrationStatus;
  sourceVersion: number;
  targetVersion: number;
  reachedVersion: number;
  appliedSteps: readonly ProjectMigrationStepDescriptor[];
  pendingStep?: ProjectMigrationStepDescriptor;
  issues: readonly ProjectMigrationIssue[];
}

export interface ProjectMigrationResult {
  document: unknown;
  report: ProjectMigrationReport;
}

export type ProjectMigrationErrorCode =
  | "PROJECT_MIGRATION_INVALID_CONFIG"
  | "PROJECT_MIGRATION_INVALID_REQUEST"
  | "PROJECT_MIGRATION_PATH_MISSING"
  | "PROJECT_MIGRATION_STEP_FAILED"
  | "PROJECT_MIGRATION_STEP_CONTRACT_INVALID"
  | "PROJECT_MIGRATION_ABORTED";

export interface ProjectMigrationErrorDiagnostic {
  code: ProjectMigrationErrorCode;
  message: string;
  sourceVersion?: number;
  targetVersion?: number;
  reachedVersion?: number;
  stepId?: string;
}

interface ProjectMigrationErrorOptions {
  sourceVersion?: number;
  targetVersion?: number;
  reachedVersion?: number;
  stepId?: string;
  cause?: unknown;
}

export class ProjectMigrationError extends Error {
  readonly code: ProjectMigrationErrorCode;
  readonly sourceVersion?: number;
  readonly targetVersion?: number;
  readonly reachedVersion?: number;
  readonly stepId?: string;
  override readonly cause?: unknown;

  constructor(
    code: ProjectMigrationErrorCode,
    message: string,
    options: ProjectMigrationErrorOptions = {},
  ) {
    super(message);
    this.name = "ProjectMigrationError";
    this.code = code;
    this.sourceVersion = options.sourceVersion;
    this.targetVersion = options.targetVersion;
    this.reachedVersion = options.reachedVersion;
    this.stepId = options.stepId;
    this.cause = options.cause;
  }

  toDiagnostic(): ProjectMigrationErrorDiagnostic {
    return {
      code: this.code,
      message: this.message,
      ...(this.sourceVersion !== undefined ? { sourceVersion: this.sourceVersion } : {}),
      ...(this.targetVersion !== undefined ? { targetVersion: this.targetVersion } : {}),
      ...(this.reachedVersion !== undefined ? { reachedVersion: this.reachedVersion } : {}),
      ...(this.stepId !== undefined ? { stepId: this.stepId } : {}),
    };
  }
}

export function isProjectMigrationError(value: unknown): value is ProjectMigrationError {
  try {
    return value instanceof ProjectMigrationError;
  } catch {
    return false;
  }
}

interface NormalizedStep<TContext> extends ProjectMigrationStepDescriptor {
  migrate: ProjectMigrationStep<TContext>["migrate"];
}

interface NormalizedMigrationRequest<TContext> {
  sourceVersion: number;
  targetVersion: number;
  context: TContext;
  signal?: AbortSignal;
}

interface OwnDataRead {
  found: boolean;
  value?: unknown;
  enumerable?: boolean;
}

function readOwnData(value: unknown, key: PropertyKey): OwnDataRead {
  if (value === null || typeof value !== "object") return { found: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? { found: true, value: descriptor.value, enumerable: descriptor.enumerable }
      : { found: false };
  } catch {
    return { found: false };
  }
}

function readStep<TContext>(value: ProjectMigrationStep<TContext>): NormalizedStep<TContext> {
  const id = readOwnData(value, "id");
  const fromVersion = readOwnData(value, "fromVersion");
  const toVersion = readOwnData(value, "toVersion");
  const migrate = readOwnData(value, "migrate");
  if (
    !id.found || typeof id.value !== "string" || id.value.trim().length === 0
    || !fromVersion.found || !Number.isSafeInteger(fromVersion.value)
    || (fromVersion.value as number) < 0
    || !toVersion.found || !Number.isSafeInteger(toVersion.value)
    || toVersion.value !== (fromVersion.value as number) + 1
    || !migrate.found || typeof migrate.value !== "function"
  ) {
    throw new ProjectMigrationError(
      "PROJECT_MIGRATION_INVALID_CONFIG",
      "Migration steps require own data id/fromVersion/toVersion/migrate fields and contiguous versions.",
    );
  }
  return Object.freeze({
    id: id.value.trim(),
    fromVersion: fromVersion.value as number,
    toVersion: toVersion.value as number,
    migrate: migrate.value as ProjectMigrationStep<TContext>["migrate"],
  });
}

function cloneDataOnly(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Migration documents must be data-only.");
  if (ancestors.has(value)) throw new TypeError("Migration documents cannot contain cycles.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = readOwnData(value, "length");
      if (!length.found || !Number.isSafeInteger(length.value) || (length.value as number) < 0) {
        throw new TypeError("Migration array length is invalid.");
      }
      const clone: unknown[] = [];
      for (let index = 0; index < (length.value as number); index += 1) {
        const item = readOwnData(value, String(index));
        if (!item.found || item.enumerable !== true) {
          throw new TypeError("Sparse/accessor/non-enumerable migration arrays are invalid.");
        }
        clone.push(cloneDataOnly(item.value, ancestors));
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => (
        key !== "length"
        && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key))
      ))) {
        throw new TypeError("Migration arrays cannot contain named or symbol properties.");
      }
      return clone;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Migration documents must contain only plain objects.");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Migration documents cannot contain symbol keys.");
    }
    const clone: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("Migration properties must be enumerable data properties.");
      }
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneDataOnly(descriptor.value, ancestors),
      });
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function deepFreezeData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreezeData(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function normalizeChoice(value: unknown): ProjectMigrationChoice {
  const id = readOwnData(value, "id");
  const label = readOwnData(value, "label");
  if (
    !id.found || typeof id.value !== "string" || id.value.trim().length === 0
    || !label.found || typeof label.value !== "string" || label.value.trim().length === 0
  ) {
    throw new TypeError("Migration ambiguity choices require id and label.");
  }
  return Object.freeze({ id: id.value.trim(), label: label.value.trim() });
}

function normalizeIssue(value: unknown): ProjectMigrationIssue {
  const code = readOwnData(value, "code");
  const path = readOwnData(value, "path");
  const message = readOwnData(value, "message");
  const entityId = readOwnData(value, "entityId");
  const category = readOwnData(value, "category");
  const severity = readOwnData(value, "severity");
  const blocking = readOwnData(value, "blocking");
  if (
    !code.found || typeof code.value !== "string" || code.value.trim().length === 0
    || !path.found || typeof path.value !== "string" || !path.value.startsWith("$")
    || !message.found || typeof message.value !== "string" || message.value.trim().length === 0
    || (entityId.found && entityId.value !== undefined
      && (typeof entityId.value !== "string" || entityId.value.length === 0))
  ) {
    throw new TypeError("Migration issue base fields are invalid.");
  }
  const base = {
    code: code.value.trim(),
    path: path.value,
    message: message.value.trim(),
    ...(entityId.found && typeof entityId.value === "string"
      ? { entityId: entityId.value }
      : {}),
  };
  if (category.value === "change" && severity.value === "info" && blocking.value === false) {
    return Object.freeze({ ...base, category: "change", severity: "info", blocking: false });
  }
  if (category.value === "warning" && severity.value === "warning" && blocking.value === false) {
    return Object.freeze({ ...base, category: "warning", severity: "warning", blocking: false });
  }
  if (
    category.value === "loss"
    && (severity.value === "warning" || severity.value === "error")
    && typeof blocking.value === "boolean"
  ) {
    return Object.freeze({
      ...base,
      category: "loss",
      severity: severity.value,
      blocking: blocking.value,
    });
  }
  if (category.value === "needs-relink" && severity.value === "error" && blocking.value === true) {
    const sourceRef = readOwnData(value, "sourceRef");
    if (!sourceRef.found || typeof sourceRef.value !== "string" || sourceRef.value.length === 0) {
      throw new TypeError("Relink issues require sourceRef.");
    }
    return Object.freeze({
      ...base,
      category: "needs-relink",
      severity: "error",
      blocking: true,
      sourceRef: sourceRef.value,
    });
  }
  if (category.value === "ambiguity" && severity.value === "error" && blocking.value === true) {
    const choices = readOwnData(value, "choices");
    if (!choices.found || !Array.isArray(choices.value) || choices.value.length < 2) {
      throw new TypeError("Ambiguity issues require at least two choices.");
    }
    return Object.freeze({
      ...base,
      category: "ambiguity",
      severity: "error",
      blocking: true,
      choices: Object.freeze(choices.value.map(normalizeChoice)),
    });
  }
  throw new TypeError("Migration issue category/severity/blocking fields are inconsistent.");
}

function normalizeIssues(value: unknown): readonly ProjectMigrationIssue[] {
  if (value === undefined) return Object.freeze([]);
  const cloned = cloneDataOnly(value);
  if (!Array.isArray(cloned)) throw new TypeError("Migration issues must be an array.");
  return Object.freeze(cloned.map(normalizeIssue));
}

function normalizeStepResult(value: unknown): ProjectMigrationStepResult {
  const status = readOwnData(value, "status");
  const issuesValue = readOwnData(value, "issues");
  const issues = normalizeIssues(issuesValue.found ? issuesValue.value : undefined);
  if (status.value === "completed") {
    const document = readOwnData(value, "document");
    if (!document.found || issues.some((issue) => issue.blocking)) {
      throw new TypeError("Completed migration steps require a document and no blocking issues.");
    }
    return { status: "completed", document: cloneDataOnly(document.value), issues };
  }
  if (status.value === "needs-input") {
    if (issues.length === 0 || !issues.some((issue) => issue.blocking)) {
      throw new TypeError("Needs-input migration steps require at least one blocking issue.");
    }
    return { status: "needs-input", issues };
  }
  throw new TypeError("Migration step status is invalid.");
}

function validateVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function abortSignalValue(
  signal: AbortSignal,
  key: "aborted" | "reason",
): unknown {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, key)?.get;
  if (!getter) throw new TypeError(`AbortSignal.${key} is unavailable.`);
  return getter.call(signal);
}

function isSignalAborted(signal: AbortSignal): boolean {
  return abortSignalValue(signal, "aborted") === true;
}

function signalReason(signal: AbortSignal): unknown {
  return abortSignalValue(signal, "reason");
}

function callSignalListenerMethod(
  signal: AbortSignal,
  method: "addEventListener" | "removeEventListener",
  listener: EventListener,
  options?: AddEventListenerOptions,
): void {
  let prototype: object | null = Object.getPrototypeOf(signal);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "function") {
      Reflect.apply(descriptor.value, signal, ["abort", listener, options]);
      return;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  throw new TypeError(`AbortSignal.${method} is unavailable.`);
}

function normalizeRequest<TContext>(value: unknown): NormalizedMigrationRequest<TContext> {
  const sourceVersion = readOwnData(value, "sourceVersion");
  const targetVersion = readOwnData(value, "targetVersion");
  const context = readOwnData(value, "context");
  const signal = readOwnData(value, "signal");
  if (
    !sourceVersion.found || !validateVersion(sourceVersion.value)
    || !targetVersion.found || !validateVersion(targetVersion.value)
    || (targetVersion.value as number) < (sourceVersion.value as number)
    || !context.found
  ) {
    throw new ProjectMigrationError(
      "PROJECT_MIGRATION_INVALID_REQUEST",
      "Migration requests require own data sourceVersion/targetVersion/context fields and ascending versions.",
    );
  }
  let normalizedSignal: AbortSignal | undefined;
  if (signal.found && signal.value !== undefined) {
    try {
      normalizedSignal = signal.value as AbortSignal;
      isSignalAborted(normalizedSignal);
    } catch (cause) {
      throw new ProjectMigrationError(
        "PROJECT_MIGRATION_INVALID_REQUEST",
        "Migration signal must be an AbortSignal.",
        {
          sourceVersion: sourceVersion.value as number,
          targetVersion: targetVersion.value as number,
          cause,
        },
      );
    }
  }
  return Object.freeze({
    sourceVersion: sourceVersion.value as number,
    targetVersion: targetVersion.value as number,
    context: context.value as TContext,
    ...(normalizedSignal ? { signal: normalizedSignal } : {}),
  });
}

function abortedError(
  request: Pick<ProjectMigrationRequest<unknown>, "sourceVersion" | "targetVersion">,
  reachedVersion: number,
  stepId?: string,
  cause?: unknown,
): ProjectMigrationError {
  return new ProjectMigrationError(
    "PROJECT_MIGRATION_ABORTED",
    `Project migration was aborted${stepId ? ` during ${stepId}` : ""}.`,
    {
      sourceVersion: request.sourceVersion,
      targetVersion: request.targetVersion,
      reachedVersion,
      stepId,
      cause,
    },
  );
}

function awaitAbortable<T>(
  work: PromiseLike<T>,
  signal: AbortSignal | undefined,
  request: Pick<ProjectMigrationRequest<unknown>, "sourceVersion" | "targetVersion">,
  reachedVersion: number,
  stepId: string,
): Promise<T> {
  if (!signal) return Promise.resolve(work);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => callSignalListenerMethod(signal, "removeEventListener", onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => finish(() => reject(abortedError(
      request,
      reachedVersion,
      stepId,
      signalReason(signal),
    )));
    callSignalListenerMethod(signal, "addEventListener", onAbort, { once: true });
    Promise.resolve(work).then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (isSignalAborted(signal)) onAbort();
  });
}

interface BoxedStepValue {
  value: unknown;
}

type ThenMethodInspection =
  | { kind: "none" }
  | { kind: "method"; method: (...args: unknown[]) => unknown }
  | { kind: "invalid"; cause: unknown };

function boxStepValue(value: unknown): BoxedStepValue {
  const box = Object.create(null) as BoxedStepValue;
  Object.defineProperty(box, "value", {
    configurable: false,
    enumerable: true,
    writable: false,
    value,
  });
  return box;
}

function inspectThenMethod(value: unknown): ThenMethodInspection {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return { kind: "none" };
  }
  try {
    let current: object | null = value as object;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, "then");
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          return {
            kind: "invalid",
            cause: new TypeError("Migration step then must be a data method."),
          };
        }
        return { kind: "method", method: descriptor.value as (...args: unknown[]) => unknown };
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return { kind: "none" };
  } catch (cause) {
    return { kind: "invalid", cause };
  }
}

function adoptDataThenable(
  value: object,
  method: (...args: unknown[]) => unknown,
): Promise<BoxedStepValue> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = (result: unknown): void => {
      if (settled) return;
      settled = true;
      resolve(boxStepValue(result));
    };
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      Reflect.apply(method, value, [resolveOnce, rejectOnce]);
    } catch (error) {
      rejectOnce(error);
    }
  });
}

function invalidStepContract(
  request: Pick<ProjectMigrationRequest<unknown>, "sourceVersion" | "targetVersion">,
  reachedVersion: number,
  stepId: string,
  cause: unknown,
): ProjectMigrationError {
  return new ProjectMigrationError(
    "PROJECT_MIGRATION_STEP_CONTRACT_INVALID",
    `Migration step ${stepId} returned an invalid result.`,
    {
      sourceVersion: request.sourceVersion,
      targetVersion: request.targetVersion,
      reachedVersion,
      stepId,
      cause,
    },
  );
}

async function settleStepReturn(
  initial: unknown,
  signal: AbortSignal | undefined,
  request: Pick<ProjectMigrationRequest<unknown>, "sourceVersion" | "targetVersion">,
  reachedVersion: number,
  stepId: string,
): Promise<BoxedStepValue> {
  let current = initial;
  const seen = new WeakSet<object>();
  while (current !== null && (typeof current === "object" || typeof current === "function")) {
    const inspection = inspectThenMethod(current);
    if (inspection.kind === "none") return boxStepValue(current);
    if (inspection.kind === "invalid") {
      throw invalidStepContract(request, reachedVersion, stepId, inspection.cause);
    }
    if (seen.has(current as object)) {
      throw invalidStepContract(
        request,
        reachedVersion,
        stepId,
        new TypeError("Migration step returned a cyclic thenable."),
      );
    }
    seen.add(current as object);
    current = (await awaitAbortable(
      adoptDataThenable(current as object, inspection.method),
      signal,
      request,
      reachedVersion,
      stepId,
    )).value;
  }
  return boxStepValue(current);
}

function stepDescriptor(step: NormalizedStep<unknown>): ProjectMigrationStepDescriptor {
  return Object.freeze({ id: step.id, fromVersion: step.fromVersion, toVersion: step.toVersion });
}

/** Ordered, data-only migration runner. Feature-specific steps remain separate. */
export class ProjectMigrator<TContext = undefined> {
  private readonly stepsByVersion: ReadonlyMap<number, NormalizedStep<TContext>>;

  constructor(steps: readonly ProjectMigrationStep<TContext>[]) {
    let isStepsArray = false;
    try {
      isStepsArray = Array.isArray(steps);
    } catch {
      // Revoked proxies and other hostile containers are invalid configuration.
    }
    if (!isStepsArray) {
      throw new ProjectMigrationError(
        "PROJECT_MIGRATION_INVALID_CONFIG",
        "Migration steps must be an array.",
      );
    }
    const byVersion = new Map<number, NormalizedStep<TContext>>();
    const ids = new Set<string>();
    const length = readOwnData(steps, "length");
    if (!length.found || !Number.isSafeInteger(length.value) || (length.value as number) < 0) {
      throw new ProjectMigrationError(
        "PROJECT_MIGRATION_INVALID_CONFIG",
        "Migration steps must be a dense array.",
      );
    }
    for (let index = 0; index < (length.value as number); index += 1) {
      const value = readOwnData(steps, String(index));
      if (!value.found) {
        throw new ProjectMigrationError(
          "PROJECT_MIGRATION_INVALID_CONFIG",
          "Migration steps must be a dense data-property array.",
        );
      }
      const step = readStep(value.value as ProjectMigrationStep<TContext>);
      if (ids.has(step.id) || byVersion.has(step.fromVersion)) {
        throw new ProjectMigrationError(
          "PROJECT_MIGRATION_INVALID_CONFIG",
          "Migration step ids and source versions must be unique.",
          { stepId: step.id },
        );
      }
      ids.add(step.id);
      byVersion.set(step.fromVersion, step);
    }
    this.stepsByVersion = byVersion;
  }

  async migrate(
    document: unknown,
    request: ProjectMigrationRequest<TContext>,
  ): Promise<ProjectMigrationResult> {
    const normalizedRequest = normalizeRequest<TContext>(request);
    if (normalizedRequest.signal && isSignalAborted(normalizedRequest.signal)) {
      throw abortedError(
        normalizedRequest,
        normalizedRequest.sourceVersion,
        undefined,
        signalReason(normalizedRequest.signal),
      );
    }
    let current: unknown;
    try {
      current = cloneDataOnly(document);
    } catch (cause) {
      throw new ProjectMigrationError(
        "PROJECT_MIGRATION_INVALID_REQUEST",
        "Migration input must be a data-only acyclic document.",
        {
          sourceVersion: normalizedRequest.sourceVersion,
          targetVersion: normalizedRequest.targetVersion,
          reachedVersion: normalizedRequest.sourceVersion,
          cause,
        },
      );
    }
    const path: NormalizedStep<TContext>[] = [];
    for (
      let version = normalizedRequest.sourceVersion;
      version < normalizedRequest.targetVersion;
      version += 1
    ) {
      const step = this.stepsByVersion.get(version);
      if (!step || step.toVersion !== version + 1) {
        throw new ProjectMigrationError(
          "PROJECT_MIGRATION_PATH_MISSING",
          `No migration step is registered for ${version}→${version + 1}.`,
          {
            sourceVersion: normalizedRequest.sourceVersion,
            targetVersion: normalizedRequest.targetVersion,
            reachedVersion: normalizedRequest.sourceVersion,
          },
        );
      }
      path.push(step);
    }

    let reachedVersion = normalizedRequest.sourceVersion;
    const appliedSteps: ProjectMigrationStepDescriptor[] = [];
    const issues: ProjectMigrationIssue[] = [];
    for (const step of path) {
      if (normalizedRequest.signal && isSignalAborted(normalizedRequest.signal)) {
        throw abortedError(
          normalizedRequest,
          reachedVersion,
          step.id,
          signalReason(normalizedRequest.signal),
        );
      }
      let rawResult: unknown;
      try {
        const stepInput = deepFreezeData(cloneDataOnly(current));
        const invoked = await awaitAbortable(
          Promise.resolve().then(() => boxStepValue(
            step.migrate(stepInput, normalizedRequest.context),
          )),
          normalizedRequest.signal,
          normalizedRequest,
          reachedVersion,
          step.id,
        );
        rawResult = (await settleStepReturn(
          invoked.value,
          normalizedRequest.signal,
          normalizedRequest,
          reachedVersion,
          step.id,
        )).value;
      } catch (cause) {
        if (isProjectMigrationError(cause) && (
          cause.code === "PROJECT_MIGRATION_ABORTED"
          || cause.code === "PROJECT_MIGRATION_STEP_CONTRACT_INVALID"
        )) {
          throw cause;
        }
        throw new ProjectMigrationError(
          "PROJECT_MIGRATION_STEP_FAILED",
          `Migration step ${step.id} failed.`,
          {
            sourceVersion: normalizedRequest.sourceVersion,
            targetVersion: normalizedRequest.targetVersion,
            reachedVersion,
            stepId: step.id,
            cause,
          },
        );
      }
      let result: ProjectMigrationStepResult;
      try {
        result = normalizeStepResult(rawResult);
      } catch (cause) {
        throw invalidStepContract(normalizedRequest, reachedVersion, step.id, cause);
      }
      issues.push(...(result.issues ?? []));
      if (result.status === "needs-input") {
        return {
          document: current,
          report: Object.freeze({
            status: "needs-input",
            sourceVersion: normalizedRequest.sourceVersion,
            targetVersion: normalizedRequest.targetVersion,
            reachedVersion,
            appliedSteps: Object.freeze(appliedSteps),
            pendingStep: stepDescriptor(step as NormalizedStep<unknown>),
            issues: Object.freeze(issues),
          }),
        };
      }
      current = result.document;
      reachedVersion = step.toVersion;
      appliedSteps.push(stepDescriptor(step as NormalizedStep<unknown>));
    }
    return {
      document: current,
      report: Object.freeze({
        status: path.length === 0 ? "unchanged" : "migrated",
        sourceVersion: normalizedRequest.sourceVersion,
        targetVersion: normalizedRequest.targetVersion,
        reachedVersion,
        appliedSteps: Object.freeze(appliedSteps),
        issues: Object.freeze(issues),
      }),
    };
  }
}
