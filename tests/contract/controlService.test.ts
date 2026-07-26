import { describe, expect, it, vi } from "vitest";
import {
  createStudioControlService,
  type StudioControlPortContext,
  type StudioControlPortResult,
  type StudioControlPorts,
} from "../../core/control/controlService";
import {
  parseStudioControlRequest,
  STUDIO_CONTROL_COMMANDS,
  STUDIO_CONTROL_MAX_REQUEST_BYTES,
  type StudioControlCommand,
  type StudioControlRequest,
} from "../../core/control/controlProtocol";

function success(result: unknown = { accepted: true }, revision = 3): StudioControlPortResult {
  return { ok: true, revision, result };
}

function request(
  command: StudioControlCommand,
  params: Record<string, unknown>,
  overrides: Partial<{
    requestId: string;
    idempotencyKey: string;
    expectedRevision: number | null;
  }> = {},
): StudioControlRequest {
  return parseStudioControlRequest({
    version: 1,
    requestId: overrides.requestId ?? "request-1",
    idempotencyKey: overrides.idempotencyKey ?? "idempotency-1",
    command,
    expectedRevision: overrides.expectedRevision ?? null,
    params,
  });
}

function createPorts(revision = 3): StudioControlPorts {
  return {
    getRevision: vi.fn(() => revision),
    getProject: vi.fn(() => success({ projectId: "project-1" }, revision)),
    getSelection: vi.fn(() => success({ assetId: "asset-1" }, revision)),
    navigate: vi.fn(() => success(undefined, revision)),
    importAsset: vi.fn(() => success({ assetId: "asset-2" }, revision + 1)),
    importVideo: vi.fn(() => success({ assetIds: ["asset-3"] }, revision + 1)),
    getModelStatus: vi.fn(() => success({ state: "ready" }, revision)),
    setupModel: vi.fn(() => success({ jobId: "job-model" }, revision)),
    listJobs: vi.fn(() => success({ jobs: [] }, revision)),
    cancelJob: vi.fn(() => success({ cancelled: true }, revision)),
    runExport: vi.fn(() => success({ jobId: "job-export" }, revision)),
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("StudioControlService command routing", () => {
  it("returns capabilities at the current revision without a command port", async () => {
    const ports = createPorts(7);
    const service = createStudioControlService({ ports });

    const response = await service.execute(request("capabilities.get", {}));

    expect(response).toEqual({
      version: 1,
      requestId: "request-1",
      ok: true,
      revision: 7,
      result: {
        protocolVersion: 1,
        maxRequestBytes: STUDIO_CONTROL_MAX_REQUEST_BYTES,
        commands: STUDIO_CONTROL_COMMANDS,
        transport: "session",
      },
    });
    expect(ports.getRevision).toHaveBeenCalledOnce();
    expect(ports.getProject).not.toHaveBeenCalled();
    expect(Object.isFrozen(response)).toBe(true);
    if (!response.ok) throw new Error("Expected a capabilities success response.");
    expect(Object.isFrozen(response.result)).toBe(true);
  });

  it.each([
    ["project.get", {}, "getProject"],
    ["selection.get", {}, "getSelection"],
    ["workspace.navigate", { workspaceId: "compose" }, "navigate"],
    ["asset.import", { path: "C:\\sprite.png" }, "importAsset"],
    [
      "video.import",
      { path: "C:\\clip.mp4", startUs: 0, endUs: 1_000, sampling: { mode: "all" } },
      "importVideo",
    ],
    ["model.status", { modelId: "birefnet-lite-512" }, "getModelStatus"],
    [
      "model.setup",
      { modelId: "birefnet-lite-512", acceptLicense: false },
      "setupModel",
    ],
    ["jobs.list", {}, "listJobs"],
    ["jobs.cancel", { jobId: "job-1" }, "cancelJob"],
    ["export.run", { format: "zip" }, "runExport"],
  ] as const)("routes %s to %s", async (command, params, method) => {
    const ports = createPorts();
    const service = createStudioControlService({ ports });

    const response = await service.execute(request(command, params));

    expect(response.ok).toBe(true);
    expect(ports[method]).toHaveBeenCalledOnce();
    expect(ports.getRevision).toHaveBeenCalledOnce();
  });

  it("passes frozen parsed params and context", async () => {
    let capturedParams: Readonly<{ path: string }> | undefined;
    let capturedContext: StudioControlPortContext | undefined;
    const ports = createPorts();
    ports.importAsset = vi.fn((params, context) => {
      capturedParams = params;
      capturedContext = context;
      return success({ assetId: "asset-2" }, 4);
    });
    const service = createStudioControlService({ ports });

    const response = await service.execute(request("asset.import", { path: "sprite.png" }));

    expect(response.ok).toBe(true);
    expect(capturedParams).toEqual({ path: "sprite.png" });
    expect(Object.isFrozen(capturedParams)).toBe(true);
    expect(capturedContext).toMatchObject({
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      expectedRevision: null,
    });
    expect(Object.isFrozen(capturedContext)).toBe(true);
    expect(capturedContext?.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps a valid typed port failure", async () => {
    const ports = createPorts();
    ports.runExport = vi.fn((): StudioControlPortResult => ({
      ok: false,
      revision: 3,
      error: { code: "busy", message: "Export is busy.", retryable: true },
    }));
    const response = await createStudioControlService({ ports }).execute(
      request("export.run", { format: "png" }),
    );

    expect(response).toEqual({
      version: 1,
      requestId: "request-1",
      ok: false,
      revision: 3,
      error: { code: "busy", message: "Export is busy.", retryable: true },
    });
  });
});

describe("StudioControlService revision and idempotency", () => {
  it("rejects a stale revision before calling the command port", async () => {
    const ports = createPorts(9);
    const response = await createStudioControlService({ ports }).execute(
      request("project.get", {}, { expectedRevision: 8 }),
    );

    expect(response).toMatchObject({
      ok: false,
      revision: 9,
      error: { code: "revision-conflict", retryable: false },
    });
    expect(ports.getRevision).toHaveBeenCalledOnce();
    expect(ports.getProject).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, -1, 1.5])("maps invalid revision %s to internal", async (revision) => {
    const ports = createPorts();
    ports.getRevision = vi.fn(() => revision);
    const response = await createStudioControlService({ ports }).execute(
      request("project.get", {}),
    );

    expect(response).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: "internal", message: "The control operation failed." },
    });
    expect(ports.getProject).not.toHaveBeenCalled();
  });

  it("shares one active execution and returns each caller requestId", async () => {
    const pending = deferred<StudioControlPortResult>();
    const ports = createPorts();
    ports.getProject = vi.fn(() => pending.promise);
    const service = createStudioControlService({ ports });
    const first = service.execute(request("project.get", {}, { requestId: "request-a" }));
    const second = service.execute(request("project.get", {}, { requestId: "request-b" }));

    expect(ports.getRevision).toHaveBeenCalledOnce();
    expect(ports.getProject).toHaveBeenCalledOnce();
    pending.resolve(success({ value: 1 }));

    await expect(first).resolves.toMatchObject({ ok: true, requestId: "request-a" });
    await expect(second).resolves.toMatchObject({ ok: true, requestId: "request-b" });
  });

  it("replays a completed outcome without revision or port calls", async () => {
    const ports = createPorts();
    const service = createStudioControlService({ ports });
    await service.execute(request("project.get", {}, { requestId: "request-a" }));
    const replay = await service.execute(request("project.get", {}, { requestId: "request-b" }));

    expect(replay).toMatchObject({ ok: true, requestId: "request-b" });
    expect(ports.getRevision).toHaveBeenCalledOnce();
    expect(ports.getProject).toHaveBeenCalledOnce();
  });

  it("rejects an idempotency collision without a command call", async () => {
    const ports = createPorts(5);
    const service = createStudioControlService({ ports });
    await service.execute(request("project.get", {}));
    const collision = await service.execute(
      request("selection.get", {}, { requestId: "request-2" }),
    );

    expect(collision).toMatchObject({
      ok: false,
      requestId: "request-2",
      revision: 5,
      error: { code: "duplicate-request", retryable: false },
    });
    expect(ports.getSelection).not.toHaveBeenCalled();
    expect(ports.getRevision).toHaveBeenCalledTimes(2);
  });

  it("evicts completed entries in FIFO order", async () => {
    const ports = createPorts();
    const service = createStudioControlService({ ports, maxIdempotencyEntries: 1 });
    await service.execute(request("project.get", {}, { idempotencyKey: "key-a" }));
    await service.execute(request("project.get", {}, { idempotencyKey: "key-b" }));
    await service.execute(request("project.get", {}, { idempotencyKey: "key-a" }));

    expect(ports.getProject).toHaveBeenCalledTimes(3);
    expect(ports.getRevision).toHaveBeenCalledTimes(3);
  });

  it("does not evict an active entry", async () => {
    const pending = deferred<StudioControlPortResult>();
    const ports = createPorts();
    ports.getProject = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockImplementation(() => success());
    const service = createStudioControlService({ ports, maxIdempotencyEntries: 1 });
    const active = service.execute(request("project.get", {}, { idempotencyKey: "key-active" }));
    await service.execute(request("project.get", {}, { idempotencyKey: "key-b" }));
    await service.execute(request("project.get", {}, { idempotencyKey: "key-c" }));
    const shared = service.execute(
      request("project.get", {}, { idempotencyKey: "key-active", requestId: "shared" }),
    );

    expect(ports.getProject).toHaveBeenCalledTimes(3);
    pending.resolve(success({ active: true }));
    await expect(active).resolves.toMatchObject({ ok: true });
    await expect(shared).resolves.toMatchObject({ ok: true, requestId: "shared" });
  });
});

describe("StudioControlService hostile boundaries", () => {
  it("rejects option accessors without invoking them", () => {
    let invoked = false;
    const options: Record<string, unknown> = {};
    Object.defineProperty(options, "ports", {
      enumerable: true,
      get() {
        invoked = true;
        return createPorts();
      },
    });

    expect(() => createStudioControlService(options as unknown as { ports: StudioControlPorts }))
      .toThrow("Studio control service options are invalid.");
    expect(invoked).toBe(false);
  });

  it("rejects port method accessors without invoking them", () => {
    let invoked = false;
    const ports = createPorts() as unknown as Record<string, unknown>;
    Object.defineProperty(ports, "getProject", {
      enumerable: true,
      get() {
        invoked = true;
        return () => success();
      },
    });

    expect(() => createStudioControlService({ ports: ports as unknown as StudioControlPorts }))
      .toThrow("Studio control service options are invalid.");
    expect(invoked).toBe(false);
  });

  it("does not invoke a getter in a port result", async () => {
    let invoked = false;
    const hostile: Record<string, unknown> = { ok: true, revision: 3 };
    Object.defineProperty(hostile, "result", {
      enumerable: true,
      get() {
        invoked = true;
        return { secret: "hidden" };
      },
    });
    const ports = createPorts();
    ports.getProject = vi.fn(() => hostile as unknown as StudioControlPortResult);

    const response = await createStudioControlService({ ports }).execute(
      request("project.get", {}),
    );

    expect(response).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(invoked).toBe(false);
  });

  it("rejects extra result and error keys", async () => {
    const ports = createPorts();
    ports.getProject = vi.fn()
      .mockImplementationOnce(() => ({
        ok: true,
        revision: 3,
        result: null,
        token: "secret",
      }) as unknown as StudioControlPortResult)
      .mockImplementationOnce(() => ({
        ok: false,
        revision: 3,
        error: {
          code: "internal",
          message: "failed",
          retryable: false,
          stack: "secret",
        },
      }) as unknown as StudioControlPortResult);
    const service = createStudioControlService({ ports });

    const outer = await service.execute(request("project.get", {}, { idempotencyKey: "outer" }));
    const nested = await service.execute(request("project.get", {}, { idempotencyKey: "nested" }));

    expect(outer).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(nested).toMatchObject({ ok: false, error: { code: "internal" } });
  });

  it.each([undefined, new Date(0)])("rejects non-JSON-safe result %s", async (result) => {
    const ports = createPorts();
    ports.getProject = vi.fn((): StudioControlPortResult => ({
      ok: true,
      revision: 3,
      result,
    }));
    const response = await createStudioControlService({ ports }).execute(
      request("project.get", {}),
    );
    expect(response).toMatchObject({ ok: false, error: { code: "internal" } });
  });

  it("does not invoke result.toJSON", async () => {
    let invoked = false;
    const result = {
      value: 1,
      toJSON() {
        invoked = true;
        return { leaked: true };
      },
    };
    const ports = createPorts();
    ports.getProject = vi.fn(() => success(result));

    const response = await createStudioControlService({ ports }).execute(
      request("project.get", {}),
    );

    expect(response).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(invoked).toBe(false);
  });

  it("redacts a secret thrown by a reflection trap", async () => {
    const secret = "REFLECTION_SECRET_81f";
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error(secret);
      },
    });
    const ports = createPorts();
    ports.getProject = vi.fn(() => hostile as StudioControlPortResult);

    const response = await createStudioControlService({ ports }).execute(
      request("project.get", {}),
    );
    const text = JSON.stringify(response);

    expect(response).toMatchObject({
      ok: false,
      error: { code: "internal", message: "The control operation failed." },
    });
    expect(text).not.toContain(secret);
  });

  it("rejects a runtime-lying request before any port access", async () => {
    let invoked = false;
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "version", {
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });
    const ports = createPorts();
    const service = createStudioControlService({ ports });

    await expect(service.execute(hostile as unknown as StudioControlRequest)).rejects.toThrow(
      "Studio control request is invalid.",
    );
    expect(invoked).toBe(false);
    expect(ports.getRevision).not.toHaveBeenCalled();
  });

  it("deep-copies and freezes a valid port result", async () => {
    const result = { items: [{ id: "one" }] };
    const ports = createPorts();
    ports.getProject = vi.fn(() => success(result));
    const response = await createStudioControlService({ ports }).execute(
      request("project.get", {}),
    );
    result.items[0].id = "mutated";

    expect(response).toMatchObject({ result: { items: [{ id: "one" }] } });
    expect(Object.isFrozen(response)).toBe(true);
    if (response.ok) {
      expect(Object.isFrozen(response.result)).toBe(true);
    }
  });
});

describe("StudioControlService disposal", () => {
  it("cancels one active idempotency key without disposing the service", async () => {
    const pending = deferred<StudioControlPortResult>();
    const ports = createPorts(8);
    ports.getProject = vi.fn(() => pending.promise);
    const service = createStudioControlService({ ports });
    const active = service.execute(request("project.get", {}));

    expect(service.cancel("missing")).toBe(false);
    expect(service.cancel("idempotency-1")).toBe(true);
    expect(service.disposed).toBe(false);
    await expect(active).resolves.toMatchObject({
      ok: false,
      revision: 8,
      error: { code: "cancelled" },
    });
    pending.resolve(success({ tooLate: true }, 9));
    await Promise.resolve();
    expect(ports.getProject).toHaveBeenCalledOnce();
  });

  it("aborts active work, resolves cancellation, and ignores late settlement", async () => {
    const pending = deferred<StudioControlPortResult>();
    let context: StudioControlPortContext | undefined;
    const ports = createPorts(6);
    ports.getProject = vi.fn((value) => {
      context = value;
      return pending.promise;
    });
    const service = createStudioControlService({ ports });
    const active = service.execute(request("project.get", {}));

    service.dispose();
    expect(service.disposed).toBe(true);
    expect(context?.signal.aborted).toBe(true);
    await expect(active).resolves.toMatchObject({
      ok: false,
      revision: 6,
      error: { code: "cancelled", retryable: false },
    });
    pending.resolve(success({ tooLate: true }, 7));
    await Promise.resolve();
    expect(service.disposed).toBe(true);
  });

  it("is idempotent and blocks new revision and port calls", async () => {
    const ports = createPorts();
    const service = createStudioControlService({ ports });
    service.dispose();
    service.dispose();

    const response = await service.execute(request("project.get", {}));

    expect(response).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: "cancelled" },
    });
    expect(ports.getRevision).not.toHaveBeenCalled();
    expect(ports.getProject).not.toHaveBeenCalled();
  });

  it("maps thrown and rejected port errors to a safe internal result", async () => {
    const secret = "PORT_SECRET_30a";
    const ports = createPorts();
    ports.getProject = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error(secret);
      })
      .mockImplementationOnce(() => Promise.reject(new Error(secret)));
    const service = createStudioControlService({ ports });

    const thrown = await service.execute(
      request("project.get", {}, { idempotencyKey: "throw" }),
    );
    const rejected = await service.execute(
      request("project.get", {}, { idempotencyKey: "reject" }),
    );

    expect(thrown).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(rejected).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(JSON.stringify([thrown, rejected])).not.toContain(secret);
  });
});
