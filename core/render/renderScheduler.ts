import type { EntityId, ProjectRevision } from "../project";

export const RENDER_INVALIDATION_REASONS = Object.freeze([
  "scene",
  "asset",
  "viewport",
  "overlay",
  "resize",
] as const);

export const CONTINUOUS_RENDER_REASONS = Object.freeze([
  "drag",
  "playback",
] as const);

export type RenderInvalidationReason = (typeof RENDER_INVALIDATION_REASONS)[number];
export type ContinuousRenderReason = (typeof CONTINUOUS_RENDER_REASONS)[number];

export interface RenderInvalidation {
  readonly reason: RenderInvalidationReason;
  readonly projectRevision?: ProjectRevision;
  readonly changedIds?: readonly EntityId[];
}

export interface ScheduledRenderFrame {
  readonly index: number;
  readonly timestamp: number;
  readonly invalidations: readonly RenderInvalidationReason[];
  readonly continuous: readonly ContinuousRenderReason[];
  readonly changedIds: readonly EntityId[];
  readonly projectRevision?: ProjectRevision;
}

export interface RenderFrameHost {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

export interface BrowserAnimationFrameScope {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

export interface RenderSchedulerDiagnostic {
  readonly code: "RENDER_SCHEDULER_HOST_FAILED" | "RENDER_FRAME_FAILED";
  readonly message: string;
  readonly frameIndex?: number;
}

export interface RenderSchedulerOptions {
  readonly host: RenderFrameHost;
  readonly render: (frame: ScheduledRenderFrame) => void | PromiseLike<void>;
  readonly onError?: (diagnostic: RenderSchedulerDiagnostic) => void;
}

export interface RenderContinuityLease {
  readonly reason: ContinuousRenderReason;
  release(): void;
}

export interface RenderSchedulerSnapshot {
  readonly disposed: boolean;
  readonly failed: boolean;
  readonly scheduled: boolean;
  readonly rendering: boolean;
  readonly frameCount: number;
  readonly pendingInvalidations: readonly RenderInvalidationReason[];
  readonly continuous: readonly ContinuousRenderReason[];
  readonly changedIds: readonly EntityId[];
  readonly projectRevision?: ProjectRevision;
}

function isRenderInvalidationReason(value: unknown): value is RenderInvalidationReason {
  return RENDER_INVALIDATION_REASONS.includes(value as RenderInvalidationReason);
}

function isContinuousRenderReason(value: unknown): value is ContinuousRenderReason {
  return CONTINUOUS_RENDER_REASONS.includes(value as ContinuousRenderReason);
}

function sortedReasons<T extends string>(order: readonly T[], values: ReadonlySet<T>): readonly T[] {
  return Object.freeze(order.filter((reason) => values.has(reason)));
}

function validateRevision(revision: ProjectRevision | undefined): void {
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) {
    throw new TypeError("Render invalidation revision must be a non-negative safe integer.");
  }
}

function validateChangedId(id: EntityId): void {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new TypeError("Render invalidation changedIds must contain non-empty strings.");
  }
}

export function createBrowserRenderFrameHost(
  scope: BrowserAnimationFrameScope = globalThis,
): RenderFrameHost {
  if (
    typeof scope.requestAnimationFrame !== "function" ||
    typeof scope.cancelAnimationFrame !== "function"
  ) {
    throw new TypeError("Browser animation-frame APIs are unavailable.");
  }
  return Object.freeze({
    requestFrame(callback: FrameRequestCallback): number {
      return scope.requestAnimationFrame(callback);
    },
    cancelFrame(handle: number): void {
      scope.cancelAnimationFrame(handle);
    },
  });
}

export class RenderScheduler {
  private readonly host: RenderFrameHost;
  private readonly renderFrame: RenderSchedulerOptions["render"];
  private readonly onError: RenderSchedulerOptions["onError"];
  private readonly pendingInvalidations = new Set<RenderInvalidationReason>();
  private readonly pendingChangedIds = new Set<EntityId>();
  private readonly continuityLeases = new Map<ContinuousRenderReason, Set<symbol>>();
  private pendingRevision: ProjectRevision | undefined;
  private scheduledToken: symbol | null = null;
  private scheduledHandle: number | null = null;
  private requestingFrame = false;
  private rendering = false;
  private disposed = false;
  private failed = false;
  private frameCount = 0;

  constructor(options: RenderSchedulerOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("RenderScheduler options are required.");
    }
    if (
      !options.host ||
      typeof options.host.requestFrame !== "function" ||
      typeof options.host.cancelFrame !== "function"
    ) {
      throw new TypeError("RenderScheduler requires a frame host.");
    }
    if (typeof options.render !== "function") {
      throw new TypeError("RenderScheduler requires a render callback.");
    }
    if (options.onError !== undefined && typeof options.onError !== "function") {
      throw new TypeError("RenderScheduler onError must be a function.");
    }
    this.host = options.host;
    this.renderFrame = options.render;
    this.onError = options.onError;
  }

  invalidate(invalidation: RenderInvalidation): void {
    if (this.disposed) return;
    if (!invalidation || typeof invalidation !== "object") {
      throw new TypeError("Render invalidation must be an object.");
    }
    if (!isRenderInvalidationReason(invalidation.reason)) {
      throw new TypeError("Render invalidation reason is invalid.");
    }
    validateRevision(invalidation.projectRevision);
    if (invalidation.changedIds !== undefined && !Array.isArray(invalidation.changedIds)) {
      throw new TypeError("Render invalidation changedIds must be an array.");
    }
    const changedIds = invalidation.changedIds ?? [];
    for (const id of changedIds) validateChangedId(id);

    this.pendingInvalidations.add(invalidation.reason);
    for (const id of changedIds) this.pendingChangedIds.add(id);
    if (invalidation.projectRevision !== undefined) {
      this.pendingRevision = this.pendingRevision === undefined
        ? invalidation.projectRevision
        : Math.max(this.pendingRevision, invalidation.projectRevision);
    }
    this.failed = false;
    this.scheduleIfNeeded();
  }

  beginContinuous(reason: ContinuousRenderReason): RenderContinuityLease {
    if (!isContinuousRenderReason(reason)) {
      throw new TypeError("Continuous render reason is invalid.");
    }
    if (this.disposed) return Object.freeze({ reason, release() {} });
    this.failed = false;
    const token = Symbol(reason);
    const tokens = this.continuityLeases.get(reason) ?? new Set<symbol>();
    tokens.add(token);
    this.continuityLeases.set(reason, tokens);
    this.scheduleIfNeeded();
    let released = false;
    return Object.freeze({
      reason,
      release: (): void => {
        if (released) return;
        released = true;
        this.releaseContinuous(reason, token);
      },
    });
  }

  getSnapshot(): RenderSchedulerSnapshot {
    const projectRevision = this.pendingRevision;
    return Object.freeze({
      disposed: this.disposed,
      failed: this.failed,
      scheduled: this.scheduledToken !== null,
      rendering: this.rendering,
      frameCount: this.frameCount,
      pendingInvalidations: sortedReasons(
        RENDER_INVALIDATION_REASONS,
        this.pendingInvalidations,
      ),
      continuous: this.continuousReasons(),
      changedIds: Object.freeze([...this.pendingChangedIds].sort()),
      ...(projectRevision === undefined ? {} : { projectRevision }),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.scheduledToken !== null) {
      const handle = this.scheduledHandle;
      this.scheduledToken = null;
      this.scheduledHandle = null;
      if (handle !== null) {
        try {
          this.host.cancelFrame(handle);
        } catch {
          this.reportError({
            code: "RENDER_SCHEDULER_HOST_FAILED",
            message: "Render scheduler could not cancel a pending frame.",
          });
        }
      }
    }
    this.pendingInvalidations.clear();
    this.pendingChangedIds.clear();
    this.pendingRevision = undefined;
    this.continuityLeases.clear();
    this.rendering = false;
    this.failed = false;
  }

  private releaseContinuous(reason: ContinuousRenderReason, token: symbol): void {
    if (this.disposed) return;
    const tokens = this.continuityLeases.get(reason);
    if (!tokens?.delete(token)) return;
    if (tokens.size === 0) this.continuityLeases.delete(reason);
    this.cancelScheduledIdleFrame();
  }

  private continuousReasons(): readonly ContinuousRenderReason[] {
    const active = new Set<ContinuousRenderReason>();
    for (const [reason, tokens] of this.continuityLeases) {
      if (tokens.size > 0) active.add(reason);
    }
    return sortedReasons(CONTINUOUS_RENDER_REASONS, active);
  }

  private hasContinuity(): boolean {
    return this.continuityLeases.size > 0;
  }

  private hasPendingInvalidation(): boolean {
    return this.pendingInvalidations.size > 0;
  }

  private shouldRender(): boolean {
    return this.hasPendingInvalidation() || this.hasContinuity();
  }

  private scheduleIfNeeded(): void {
    if (
      this.disposed ||
      this.failed ||
      this.requestingFrame ||
      this.rendering ||
      this.scheduledToken !== null ||
      !this.shouldRender()
    ) {
      return;
    }
    const token = Symbol("scheduled-render-frame");
    let callbackRan = false;
    let requestSucceeded = false;
    this.scheduledToken = token;
    this.requestingFrame = true;
    try {
      const handle = this.host.requestFrame((timestamp) => {
        callbackRan = true;
        this.runScheduledFrame(timestamp, token);
      });
      requestSucceeded = true;
      if (this.scheduledToken === token) {
        this.scheduledHandle = handle;
      } else if (!callbackRan) {
        try {
          this.host.cancelFrame(handle);
        } catch {
          this.reportError({
            code: "RENDER_SCHEDULER_HOST_FAILED",
            message: "Render scheduler could not cancel a reentrant frame request.",
          });
        }
      }
    } catch {
      if (this.scheduledToken === token) this.scheduledToken = null;
      this.scheduledHandle = null;
      this.reportError({
        code: "RENDER_SCHEDULER_HOST_FAILED",
        message: "Render scheduler could not request a frame.",
      });
    } finally {
      this.requestingFrame = false;
    }
    if (requestSucceeded) this.scheduleIfNeeded();
  }

  private cancelScheduledIdleFrame(): void {
    if (
      this.disposed ||
      this.scheduledToken === null ||
      this.hasPendingInvalidation() ||
      this.hasContinuity()
    ) {
      return;
    }
    const handle = this.scheduledHandle;
    this.scheduledToken = null;
    this.scheduledHandle = null;
    if (handle !== null) {
      try {
        this.host.cancelFrame(handle);
      } catch {
        this.reportError({
          code: "RENDER_SCHEDULER_HOST_FAILED",
          message: "Render scheduler could not cancel an idle frame.",
        });
      }
    }
  }

  private takeFrame(timestamp: number): ScheduledRenderFrame {
    this.frameCount += 1;
    const projectRevision = this.pendingRevision;
    const frame = Object.freeze({
      index: this.frameCount,
      timestamp,
      invalidations: sortedReasons(RENDER_INVALIDATION_REASONS, this.pendingInvalidations),
      continuous: this.continuousReasons(),
      changedIds: Object.freeze([...this.pendingChangedIds].sort()),
      ...(projectRevision === undefined ? {} : { projectRevision }),
    });
    this.pendingInvalidations.clear();
    this.pendingChangedIds.clear();
    this.pendingRevision = undefined;
    return frame;
  }

  private runScheduledFrame(timestamp: number, token: symbol): void {
    if (this.scheduledToken !== token) return;
    this.scheduledToken = null;
    this.scheduledHandle = null;
    if (this.disposed || this.rendering || !this.shouldRender()) return;
    const frame = this.takeFrame(timestamp);
    this.rendering = true;
    let result: void | PromiseLike<void>;
    try {
      result = this.renderFrame(frame);
    } catch {
      this.finishFrame(frame, true);
      return;
    }
    Promise.resolve(result).then(
      () => this.finishFrame(frame, false),
      () => this.finishFrame(frame, true),
    );
  }

  private finishFrame(frame: ScheduledRenderFrame, failed: boolean): void {
    if (this.disposed) return;
    this.rendering = false;
    if (failed) {
      for (const reason of frame.invalidations) this.pendingInvalidations.add(reason);
      for (const id of frame.changedIds) this.pendingChangedIds.add(id);
      if (frame.projectRevision !== undefined) {
        this.pendingRevision = this.pendingRevision === undefined
          ? frame.projectRevision
          : Math.max(this.pendingRevision, frame.projectRevision);
      }
      this.continuityLeases.clear();
      this.failed = true;
      this.reportError({
        code: "RENDER_FRAME_FAILED",
        message: "Scheduled render frame failed.",
        frameIndex: frame.index,
      });
    }
    if (!failed) this.scheduleIfNeeded();
  }

  private reportError(diagnostic: RenderSchedulerDiagnostic): void {
    if (!this.onError) return;
    try {
      this.onError(Object.freeze({ ...diagnostic }));
    } catch {
      // Diagnostics cannot destabilize scheduler state.
    }
  }
}

export function createRenderScheduler(options: RenderSchedulerOptions): RenderScheduler {
  return new RenderScheduler(options);
}
