import {
  CONTINUOUS_RENDER_REASONS,
  RENDER_INVALIDATION_REASONS,
  createBrowserRenderFrameHost,
  createRenderScheduler,
  type RenderFrameHost,
  type RenderSchedulerDiagnostic,
  type ScheduledRenderFrame,
} from "../../core/render";

class ManualFrameHost implements RenderFrameHost {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();
  requestCount = 0;
  readonly cancelled: number[] = [];

  requestFrame(callback: FrameRequestCallback): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.requestCount += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  }

  flushNext(timestamp: number): void {
    const next = [...this.callbacks.entries()].sort(([left], [right]) => left - right)[0];
    if (!next) throw new Error("No animation frame is pending.");
    const [handle, callback] = next;
    this.callbacks.delete(handle);
    callback(timestamp);
  }

  get pendingCount(): number {
    return this.callbacks.size;
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushSchedulerMicrotasks(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

function assertDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) assertDeepFrozen(descriptor.value, seen);
  }
}

describe("RenderScheduler", () => {
  it("starts and remains at zero rAF while idle", () => {
    const host = new ManualFrameHost();
    const scheduler = createRenderScheduler({ host, render() {} });

    expect(host.requestCount).toBe(0);
    expect(host.pendingCount).toBe(0);
    expect(scheduler.getSnapshot()).toEqual({
      disposed: false,
      suspended: false,
      failed: false,
      scheduled: false,
      rendering: false,
      frameCount: 0,
      pendingInvalidations: [],
      continuous: [],
      changedIds: [],
    });
  });

  it("suspends pending and continuous work without losing it, then resumes once", async () => {
    const host = new ManualFrameHost();
    const frames: ScheduledRenderFrame[] = [];
    const scheduler = createRenderScheduler({ host, render: (frame) => { frames.push(frame); } });
    const lease = scheduler.beginContinuous("playback");
    scheduler.invalidate({ reason: "resize", projectRevision: 4 });
    expect(host.pendingCount).toBe(1);

    scheduler.suspend();
    expect(host.pendingCount).toBe(0);
    expect(scheduler.getSnapshot()).toMatchObject({
      suspended: true,
      scheduled: false,
      continuous: ["playback"],
      pendingInvalidations: ["resize"],
      projectRevision: 4,
    });

    scheduler.resume();
    expect(host.pendingCount).toBe(1);
    host.flushNext(8);
    await flushSchedulerMicrotasks();
    lease.release();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      invalidations: ["resize"],
      continuous: ["playback"],
      projectRevision: 4,
    });
    expect(scheduler.getSnapshot()).toMatchObject({
      suspended: false,
      scheduled: false,
      rendering: false,
    });
    expect(host.pendingCount).toBe(0);
  });

  it("does not retain a stale handle if a host invokes a one-shot callback synchronously", async () => {
    let requests = 0;
    const frames: ScheduledRenderFrame[] = [];
    const scheduler = createRenderScheduler({
      host: {
        requestFrame(callback) { requests += 1; callback(5); return 99; },
        cancelFrame() {},
      },
      render: (frame) => { frames.push(frame); },
    });

    scheduler.invalidate({ reason: "scene" });
    await flushSchedulerMicrotasks();

    expect(requests).toBe(1);
    expect(frames).toHaveLength(1);
    expect(scheduler.getSnapshot()).toMatchObject({ scheduled: false, rendering: false });
  });

  it("does not recursively request when a host failure observer reinvalidates", async () => {
    const diagnostics: RenderSchedulerDiagnostic[] = [];
    const frames: ScheduledRenderFrame[] = [];
    let requests = 0;
    let failRequest = true;
    let pendingCallback: FrameRequestCallback | undefined;
    let reinvalidate = (): void => {};
    const scheduler = createRenderScheduler({
      host: {
        requestFrame(callback) {
          requests += 1;
          if (failRequest) throw new Error("request failed");
          pendingCallback = callback;
          return 7;
        },
        cancelFrame() {},
      },
      render(frame) { frames.push(frame); },
      onError(diagnostic) {
        diagnostics.push(diagnostic);
        reinvalidate();
      },
    });
    reinvalidate = () => scheduler.invalidate({ reason: "scene" });

    scheduler.invalidate({ reason: "scene" });

    expect(requests).toBe(1);
    expect(diagnostics).toEqual([{
      code: "RENDER_SCHEDULER_HOST_FAILED",
      message: "Render scheduler could not request a frame.",
    }]);
    expect(scheduler.getSnapshot()).toMatchObject({
      scheduled: false,
      pendingInvalidations: ["scene"],
    });

    failRequest = false;
    scheduler.invalidate({ reason: "viewport" });
    expect(requests).toBe(2);
    if (!pendingCallback) throw new Error("Expected a retry frame callback.");
    pendingCallback(20);
    await flushSchedulerMicrotasks();

    expect(frames.map((frame) => frame.invalidations)).toEqual([["scene", "viewport"]]);
  });

  it.each(["release", "dispose"] as const)(
    "cancels a frame handle returned after reentrant %s",
    async (action) => {
      const callbacks = new Map<number, FrameRequestCallback>();
      const cancelled: number[] = [];
      let requests = 0;
      let release = (): void => {};
      let dispose = (): void => {};
      const host: RenderFrameHost = {
        requestFrame(callback) {
          requests += 1;
          callbacks.set(requests, callback);
          if (requests === 2) {
            if (action === "release") release();
            else dispose();
          }
          return requests;
        },
        cancelFrame(handle) {
          cancelled.push(handle);
          callbacks.delete(handle);
        },
      };
      const scheduler = createRenderScheduler({ host, render() {} });
      dispose = () => scheduler.dispose();
      const lease = scheduler.beginContinuous("drag");
      release = lease.release;
      const firstCallback = callbacks.get(1);
      if (!firstCallback) throw new Error("Expected the first continuity frame.");
      callbacks.delete(1);
      firstCallback(1);
      await flushSchedulerMicrotasks();

      expect(requests).toBe(2);
      expect(cancelled).toContain(2);
      expect(callbacks.size).toBe(0);
      expect(scheduler.getSnapshot()).toMatchObject({
        disposed: action === "dispose",
        scheduled: false,
        continuous: [],
      });
    },
  );

  it("ignores a stale callback when host cancellation throws", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const diagnostics: RenderSchedulerDiagnostic[] = [];
    const frames: ScheduledRenderFrame[] = [];
    let nextHandle = 1;
    const scheduler = createRenderScheduler({
      host: {
        requestFrame(callback) {
          const handle = nextHandle;
          nextHandle += 1;
          callbacks.set(handle, callback);
          return handle;
        },
        cancelFrame() { throw new Error("host retained callback"); },
      },
      render(frame) { frames.push(frame); },
      onError(diagnostic) { diagnostics.push(diagnostic); },
    });
    const lease = scheduler.beginContinuous("drag");
    lease.release();
    expect(diagnostics).toEqual([{
      code: "RENDER_SCHEDULER_HOST_FAILED",
      message: "Render scheduler could not cancel an idle frame.",
    }]);

    scheduler.invalidate({ reason: "scene" });
    const staleCallback = callbacks.get(1);
    const currentCallback = callbacks.get(2);
    if (!staleCallback || !currentCallback) throw new Error("Expected both host callbacks.");
    staleCallback(1);
    expect(frames).toEqual([]);
    expect(scheduler.getSnapshot().scheduled).toBe(true);
    currentCallback(2);
    await flushSchedulerMicrotasks();

    expect(frames).toHaveLength(1);
    expect(frames[0].invalidations).toEqual(["scene"]);
    expect(scheduler.getSnapshot().scheduled).toBe(false);
  });

  it("coalesces invalidations, revisions and changed IDs into one deterministic frame", async () => {
    const host = new ManualFrameHost();
    const frames: ScheduledRenderFrame[] = [];
    const scheduler = createRenderScheduler({ host, render: (frame) => { frames.push(frame); } });

    scheduler.invalidate({ reason: "viewport" });
    scheduler.invalidate({ reason: "scene", projectRevision: 4, changedIds: ["z", "a"] });
    scheduler.invalidate({ reason: "overlay", changedIds: ["m", "a"] });
    scheduler.invalidate({ reason: "scene", projectRevision: 7, changedIds: ["b"] });

    expect(host.requestCount).toBe(1);
    expect(host.pendingCount).toBe(1);
    expect(scheduler.getSnapshot()).toMatchObject({
      scheduled: true,
      pendingInvalidations: ["scene", "viewport", "overlay"],
      changedIds: ["a", "b", "m", "z"],
      projectRevision: 7,
    });

    host.flushNext(42);
    await flushSchedulerMicrotasks();

    expect(frames).toEqual([{
      index: 1,
      timestamp: 42,
      invalidations: ["scene", "viewport", "overlay"],
      continuous: [],
      changedIds: ["a", "b", "m", "z"],
      projectRevision: 7,
    }]);
    assertDeepFrozen(frames[0]);
    expect(host.pendingCount).toBe(0);
    expect(host.requestCount).toBe(1);
    expect(scheduler.getSnapshot()).toMatchObject({
      scheduled: false,
      rendering: false,
      frameCount: 1,
      pendingInvalidations: [],
      changedIds: [],
    });
  });

  it("rejects invalidation input atomically", () => {
    const host = new ManualFrameHost();
    const scheduler = createRenderScheduler({ host, render() {} });

    expect(() => scheduler.invalidate({ reason: "invalid" as "scene" })).toThrow(TypeError);
    expect(() => scheduler.invalidate({ reason: "scene", projectRevision: -1 })).toThrow(TypeError);
    expect(() => scheduler.invalidate({ reason: "scene", changedIds: [""] })).toThrow(TypeError);
    expect(() => scheduler.invalidate({
      reason: "scene",
      changedIds: "asset" as unknown as readonly string[],
    })).toThrow(TypeError);
    expect(() => scheduler.beginContinuous("idle" as "drag")).toThrow(TypeError);
    expect(host.requestCount).toBe(0);
    expect(scheduler.getSnapshot().pendingInvalidations).toEqual([]);
  });

  it("reference-counts overlapping drag/playback leases and cancels the empty tail", async () => {
    const host = new ManualFrameHost();
    const frames: ScheduledRenderFrame[] = [];
    const scheduler = createRenderScheduler({ host, render: (frame) => { frames.push(frame); } });
    const dragA = scheduler.beginContinuous("drag");
    const dragB = scheduler.beginContinuous("drag");
    const playback = scheduler.beginContinuous("playback");

    expect(host.requestCount).toBe(1);
    expect(scheduler.getSnapshot().continuous).toEqual(["drag", "playback"]);
    host.flushNext(10);
    await flushSchedulerMicrotasks();
    expect(frames[0]).toMatchObject({
      invalidations: [],
      continuous: ["drag", "playback"],
    });
    expect(host.pendingCount).toBe(1);
    expect(host.requestCount).toBe(2);

    dragA.release();
    dragA.release();
    expect(host.pendingCount).toBe(1);
    dragB.release();
    expect(host.pendingCount).toBe(1);
    playback.release();

    expect(host.pendingCount).toBe(0);
    expect(host.cancelled).toHaveLength(1);
    expect(scheduler.getSnapshot().continuous).toEqual([]);
  });

  it("serializes async renders and coalesces changes that arrive in flight", async () => {
    const host = new ManualFrameHost();
    const firstFrame = createDeferred<void>();
    const frames: ScheduledRenderFrame[] = [];
    let activeRenders = 0;
    let maxActiveRenders = 0;
    const scheduler = createRenderScheduler({
      host,
      render(frame) {
        frames.push(frame);
        activeRenders += 1;
        maxActiveRenders = Math.max(maxActiveRenders, activeRenders);
        if (frame.index === 1) {
          return firstFrame.promise.finally(() => { activeRenders -= 1; });
        }
        activeRenders -= 1;
      },
    });
    const playback = scheduler.beginContinuous("playback");

    host.flushNext(1);
    expect(scheduler.getSnapshot().rendering).toBe(true);
    expect(host.pendingCount).toBe(0);
    scheduler.invalidate({ reason: "scene", projectRevision: 9, changedIds: ["asset-b"] });
    scheduler.invalidate({ reason: "viewport" });
    const drag = scheduler.beginContinuous("drag");
    expect(host.requestCount).toBe(1);
    expect(maxActiveRenders).toBe(1);

    firstFrame.resolve();
    await flushSchedulerMicrotasks();
    expect(host.requestCount).toBe(2);
    expect(host.pendingCount).toBe(1);
    host.flushNext(2);
    await flushSchedulerMicrotasks();

    expect(maxActiveRenders).toBe(1);
    expect(frames[1]).toMatchObject({
      index: 2,
      invalidations: ["scene", "viewport"],
      continuous: ["drag", "playback"],
      changedIds: ["asset-b"],
      projectRevision: 9,
    });
    playback.release();
    drag.release();
    expect(host.pendingCount).toBe(0);
  });

  it("schedules exactly one follow-up for a reentrant invalidation", async () => {
    const host = new ManualFrameHost();
    const frames: ScheduledRenderFrame[] = [];
    let invalidateReentrant = (): void => {};
    const scheduler = createRenderScheduler({
      host,
      render(frame) {
        frames.push(frame);
        if (frame.index === 1) invalidateReentrant();
      },
    });
    invalidateReentrant = () => scheduler.invalidate({ reason: "overlay" });
    scheduler.invalidate({ reason: "scene" });

    host.flushNext(1);
    await flushSchedulerMicrotasks();
    expect(host.pendingCount).toBe(1);
    expect(host.requestCount).toBe(2);
    host.flushNext(2);
    await flushSchedulerMicrotasks();

    expect(frames.map((frame) => frame.invalidations)).toEqual([["scene"], ["overlay"]]);
    expect(host.pendingCount).toBe(0);
    expect(host.requestCount).toBe(2);
  });

  it("halts continuity, preserves dirty state and isolates stale leases after failure", async () => {
    const host = new ManualFrameHost();
    const diagnostics: RenderSchedulerDiagnostic[] = [];
    const frames: ScheduledRenderFrame[] = [];
    let fail = true;
    const scheduler = createRenderScheduler({
      host,
      render(frame) {
        frames.push(frame);
        if (fail) throw new Error("render failed");
      },
      onError(diagnostic) {
        diagnostics.push(diagnostic);
        throw new Error("observer failure");
      },
    });
    const failedLease = scheduler.beginContinuous("playback");
    scheduler.invalidate({ reason: "scene", projectRevision: 1, changedIds: ["asset-old"] });

    host.flushNext(12);
    expect(diagnostics).toEqual([{
      code: "RENDER_FRAME_FAILED",
      message: "Scheduled render frame failed.",
      frameIndex: 1,
    }]);
    assertDeepFrozen(diagnostics[0]);
    expect(scheduler.getSnapshot()).toMatchObject({
      failed: true,
      scheduled: false,
      rendering: false,
      continuous: [],
      pendingInvalidations: ["scene"],
      changedIds: ["asset-old"],
      projectRevision: 1,
    });
    expect(host.pendingCount).toBe(0);

    fail = false;
    const retryLease = scheduler.beginContinuous("playback");
    failedLease.release();
    expect(scheduler.getSnapshot().continuous).toEqual(["playback"]);
    expect(scheduler.getSnapshot().failed).toBe(false);
    host.flushNext(13);
    await flushSchedulerMicrotasks();
    retryLease.release();
    expect(scheduler.getSnapshot()).toMatchObject({
      failed: false,
      frameCount: 2,
      scheduled: false,
      rendering: false,
    });
    expect(scheduler.getSnapshot().pendingInvalidations).toEqual([]);
    expect(frames[1]).toMatchObject({
      invalidations: ["scene"],
      continuous: ["playback"],
      changedIds: ["asset-old"],
      projectRevision: 1,
    });
  });

  it("cancels pending work and ignores late async completion after dispose", async () => {
    const pendingHost = new ManualFrameHost();
    const pendingScheduler = createRenderScheduler({ host: pendingHost, render() {} });
    pendingScheduler.beginContinuous("drag");
    pendingScheduler.dispose();
    expect(pendingHost.pendingCount).toBe(0);
    expect(pendingHost.cancelled).toHaveLength(1);

    const host = new ManualFrameHost();
    const frame = createDeferred<void>();
    const scheduler = createRenderScheduler({ host, render: () => frame.promise });
    const lease = scheduler.beginContinuous("playback");
    host.flushNext(1);
    expect(scheduler.getSnapshot().rendering).toBe(true);
    scheduler.dispose();
    lease.release();
    expect(scheduler.getSnapshot()).toMatchObject({
      disposed: true,
      scheduled: false,
      rendering: false,
      continuous: [],
      pendingInvalidations: [],
    });

    frame.resolve();
    await flushSchedulerMicrotasks();
    expect(host.requestCount).toBe(1);
    expect(host.pendingCount).toBe(0);
  });
});

describe("render frame host contracts", () => {
  it("exposes stable reason order and binds browser frame APIs", () => {
    expect(RENDER_INVALIDATION_REASONS).toEqual([
      "scene", "asset", "viewport", "overlay", "resize",
    ]);
    expect(CONTINUOUS_RENDER_REASONS).toEqual(["drag", "playback"]);
    const calls: Array<readonly unknown[]> = [];
    const callback = () => {};
    const host = createBrowserRenderFrameHost({
      requestAnimationFrame(received) { calls.push(["request", received]); return 17; },
      cancelAnimationFrame(handle) { calls.push(["cancel", handle]); },
    });

    expect(host.requestFrame(callback)).toBe(17);
    host.cancelFrame(17);
    expect(calls).toEqual([["request", callback], ["cancel", 17]]);
    expect(Object.isFrozen(host)).toBe(true);
  });
});
