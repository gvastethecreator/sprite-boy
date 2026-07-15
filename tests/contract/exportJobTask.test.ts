import { getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  EXPORT_PORT_ERROR_CODES,
  ExportPortError,
  createExportFormatRegistry,
  createExportPort,
  type ArtifactWriter,
  type ExportFormatDescriptor,
  type ExportFormatProvider,
  type ExportPort,
  type ExportPortErrorCode,
  type ExportResult,
} from "../../core/export";
import {
  createExportJobTask,
  createJobRunner,
  createQueuedJob,
  retryJob,
  toExportJobTaskError,
  type ExportJobRequest,
  type JobRunnerHost,
  type JobTaskContext,
} from "../../core/processing";
import { createJobStore } from "../../core/stores";

const T0 = "2026-07-15T20:00:00.000Z";
const T1 = "2026-07-15T20:00:01.000Z";
const T2 = "2026-07-15T20:00:02.000Z";
const T3 = "2026-07-15T20:00:03.000Z";

const PNG_FORMAT: ExportFormatDescriptor = Object.freeze({
  id: "raster.png",
  label: "PNG image",
  category: "raster-image",
  fileExtension: "png",
  mimeType: "image/png",
});

const BASE_JOB_REQUEST: ExportJobRequest<{ readonly scene: string }> = {
  artifactId: "artifact-export-job",
  projectId: "project-export-job",
  revision: 5,
  formatId: PNG_FORMAT.id,
  baseName: "hero-run",
  source: { scene: "canonical" },
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function taskContext(requestId = "job-request-1", signal = new AbortController().signal) {
  return Object.freeze({
    requestId,
    signal,
    reportProgress: vi.fn(() => true),
  }) satisfies JobTaskContext;
}

function fakeResult(): ExportResult {
  return Object.freeze({ marker: "export-result" }) as unknown as ExportResult;
}

function queuedJob(id: string, requestId = `${id}-request`) {
  return createQueuedJob({
    id,
    requestId,
    kind: "export.render",
    label: `Export ${id}`,
    createdAt: T0,
    timeoutMs: null,
  });
}

class ManualHost implements JobRunnerHost {
  current = T1;
  readonly now = (): string => this.current;
  readonly setTimer = (): unknown => {
    throw new Error("Unexpected timer for timeout-free export job.");
  };
  readonly clearTimer = (): void => undefined;
}

function createRealPort(writer: ArtifactWriter, requests: string[] = []) {
  const provider: ExportFormatProvider = {
    format: PNG_FORMAT,
    encode: vi.fn((request) => {
      requests.push(request.requestId);
      return new Blob(["png"], { type: "image/png" });
    }),
  };
  return createExportPort({
    registry: createExportFormatRegistry([provider]),
    writer,
    now: () => T3,
  });
}

describe("export job diagnostics", () => {
  it("maps every branded ExportPortError to one exhaustive safe JobTaskError", () => {
    const expected: Record<
      ExportPortErrorCode,
      { readonly code: string; readonly message: string; readonly retryable: boolean }
    > = {
      EXPORT_FORMAT_INVALID: {
        code: "export-failure",
        message: "Export format configuration is invalid.",
        retryable: false,
      },
      EXPORT_FORMAT_CONFLICT: {
        code: "export-failure",
        message: "Export format configuration is conflicting.",
        retryable: false,
      },
      EXPORT_INVALID_REQUEST: {
        code: "invalid-input",
        message: "Export request is invalid.",
        retryable: false,
      },
      EXPORT_UNSUPPORTED_FORMAT: {
        code: "unsupported",
        message: "This export format is not supported.",
        retryable: false,
      },
      EXPORT_PROVIDER_FAILED: {
        code: "provider-failure",
        message: "The export provider failed.",
        retryable: true,
      },
      EXPORT_ARTIFACT_INVALID: {
        code: "export-failure",
        message: "The export provider returned an invalid artifact.",
        retryable: false,
      },
      EXPORT_ARTIFACT_TOO_LARGE: {
        code: "export-failure",
        message: "The export artifact exceeds the allowed size.",
        retryable: false,
      },
      EXPORT_QUOTA_EXCEEDED: {
        code: "quota-exceeded",
        message: "Storage quota was exceeded. Free space, then retry.",
        retryable: true,
      },
      EXPORT_WRITER_FAILED: {
        code: "storage-failure",
        message: "The export destination could not save the artifact.",
        retryable: true,
      },
      EXPORT_RECEIPT_INVALID: {
        code: "export-failure",
        message: "The export destination returned an invalid receipt.",
        retryable: false,
      },
      EXPORT_ABORTED: {
        code: "export-failure",
        message: "Export stopped before completion.",
        retryable: true,
      },
    };

    expect(new Set(Object.keys(expected))).toEqual(new Set(EXPORT_PORT_ERROR_CODES));
    for (const code of EXPORT_PORT_ERROR_CODES) {
      const mapped = toExportJobTaskError(
        new ExportPortError(code, `private ${code} provider path`),
      );
      expect(mapped).toMatchObject(expected[code]);
      expect(mapped.message).not.toMatch(/private|provider path/);
    }
  });

  it("redacts unknown, plain-object and prototype-spoofed errors without reading getters", () => {
    let getterReads = 0;
    const spoof = Object.create(ExportPortError.prototype);
    Object.defineProperty(spoof, "code", {
      get() {
        getterReads += 1;
        return "EXPORT_UNSUPPORTED_FORMAT";
      },
    });
    const candidates: unknown[] = [
      new Error("private provider credential"),
      { code: "EXPORT_QUOTA_EXCEEDED", message: "private quota" },
      spoof,
    ];

    for (const candidate of candidates) {
      expect(toExportJobTaskError(candidate)).toMatchObject({
        code: "export-failure",
        message: "Export failed.",
        retryable: true,
      });
    }
    expect(getterReads).toBe(0);
  });

  it("captures the port and request while deriving identity and signal from JobRunner context", async () => {
    const result = fakeResult();
    const originalRun = vi.fn(async (_request: Parameters<ExportPort["run"]>[0]) => result);
    const mutablePort: ExportPort = {
      maxArtifactBytes: 1,
      listFormats: () => [PNG_FORMAT],
      run: originalRun,
    };
    const mutableRequest = {
      ...BASE_JOB_REQUEST,
      source: { scene: "original" },
    };
    const task = createExportJobTask({ port: mutablePort, request: mutableRequest });
    mutablePort.run = async () => {
      throw new Error("replacement must not run");
    };
    mutableRequest.artifactId = "mutated-artifact";
    mutableRequest.source = { scene: "mutated" };
    const context = taskContext("canonical-attempt-request");

    await expect(task(context)).resolves.toBe(result);
    expect(originalRun).toHaveBeenCalledTimes(1);
    const captured = originalRun.mock.calls[0][0];
    expect(Object.isFrozen(captured)).toBe(true);
    expect(captured).toMatchObject({
      requestId: "canonical-attempt-request",
      artifactId: BASE_JOB_REQUEST.artifactId,
      source: { scene: "original" },
      signal: context.signal,
    });
    expect(Object.isFrozen(task)).toBe(true);
  });

  it("rejects accessors, missing/extra identity fields and hostile port methods before work", () => {
    const run = vi.fn(async () => fakeResult());
    const port: ExportPort = { maxArtifactBytes: 1, listFormats: () => [], run };
    let getterReads = 0;
    const accessorRequest = { ...BASE_JOB_REQUEST } as Record<string, unknown>;
    Object.defineProperty(accessorRequest, "source", {
      enumerable: true,
      get() {
        getterReads += 1;
        return "private";
      },
    });
    expect(() => createExportJobTask({
      port,
      request: accessorRequest as ExportJobRequest,
    })).toThrow(/source must be an enumerable data property/);
    expect(getterReads).toBe(0);

    expect(() => createExportJobTask({
      port,
      request: { ...BASE_JOB_REQUEST, requestId: "forged" } as ExportJobRequest,
    })).toThrow(/request fields are invalid/);
    expect(() => createExportJobTask({
      port,
      request: { ...BASE_JOB_REQUEST, signal: new AbortController().signal } as ExportJobRequest,
    })).toThrow(/request fields are invalid/);

    const hostilePort = Object.defineProperty({}, "run", {
      enumerable: true,
      get() {
        getterReads += 1;
        return run;
      },
    });
    expect(() => createExportJobTask({
      port: hostilePort as ExportPort,
      request: BASE_JOB_REQUEST,
    })).toThrow(/port.run must be an enumerable data property/);
    expect(getterReads).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("maps native quota to an actionable retry and preserves attempt identity", async () => {
    const providerRequestIds: string[] = [];
    let writes = 0;
    const writer: ArtifactWriter = {
      id: "retry-writer",
      write: vi.fn((request) => {
        writes += 1;
        if (writes === 1) {
          throw new DOMException("private device capacity", "QuotaExceededError");
        }
        return {
          requestId: request.artifact.requestId,
          artifactId: request.artifact.artifactId,
          fileName: request.artifact.fileName,
          bytesWritten: request.artifact.byteSize,
        };
      }),
    };
    const port = createRealPort(writer, providerRequestIds);
    const task = createExportJobTask({ port, request: BASE_JOB_REQUEST });
    const store = createJobStore();
    const host = new ManualHost();
    const runner = createJobRunner({ store, host });

    const first = runner.run(queuedJob("job-export-root"), task);
    const firstResult = await first.result;
    expect(firstResult).toMatchObject({
      status: "failed",
      job: {
        error: {
          code: "quota-exceeded",
          message: "Storage quota was exceeded. Free space, then retry.",
          retryable: true,
        },
      },
    });
    expect(JSON.stringify(firstResult)).not.toMatch(/device capacity|QuotaExceededError/);
    if (firstResult.status !== "failed") throw new Error("Expected quota failure.");
    const retry = retryJob(firstResult.job, {
      id: "job-export-retry",
      requestId: "job-export-retry-request",
      createdAt: T2,
    }).retry;
    if (!retry) throw new Error("Expected actionable retry.");
    host.current = T3;

    const second = runner.run(retry, task);
    await expect(second.result).resolves.toMatchObject({
      status: "succeeded",
      job: { attempt: 2, previousJobId: first.jobId },
    });
    expect(providerRequestIds).toEqual([first.requestId, second.requestId]);
    expect(store.getSnapshot().jobs[first.jobId]).toEqual(firstResult.job);
    expect(runner.getActiveCount()).toBe(0);
  });

  it("keeps cancel authoritative when the adapter later maps ExportPort abort", async () => {
    const pending = deferred<Blob>();
    const writer: ArtifactWriter = {
      id: "memory-writer",
      write: vi.fn((request) => ({
        requestId: request.artifact.requestId,
        artifactId: request.artifact.artifactId,
        fileName: request.artifact.fileName,
        bytesWritten: request.artifact.byteSize,
      })),
    };
    const provider: ExportFormatProvider = {
      format: PNG_FORMAT,
      encode: () => pending.promise,
    };
    const port = createExportPort({
      registry: createExportFormatRegistry([provider]),
      writer,
      now: () => T3,
    });
    const task = createExportJobTask({ port, request: BASE_JOB_REQUEST });
    const store = createJobStore();
    const runner = createJobRunner({ store, host: new ManualHost() });
    let adapterResult!: Promise<ExportResult>;
    let taskSignal!: AbortSignal;
    const handle = runner.run(queuedJob("job-export-cancel"), (context) => {
      taskSignal = context.signal;
      adapterResult = Promise.resolve(task(context));
      return adapterResult;
    });
    await flushMicrotasks();

    expect(handle.cancel("User stopped export.")).toBe(true);
    const result = await handle.result;
    expect(result).toMatchObject({
      status: "cancelled",
      job: { error: { code: "cancelled", message: "User stopped export." } },
    });
    const terminalSnapshot = store.getSnapshot();
    await expect(adapterResult).rejects.toMatchObject({
      code: "export-failure",
      message: "Export stopped before completion.",
    });
    pending.reject(new Error("private late worker dump"));
    await flushMicrotasks();

    expect(store.getSnapshot()).toBe(terminalSnapshot);
    expect(writer.write).not.toHaveBeenCalled();
    expect(getEventListeners(taskSignal, "abort")).toHaveLength(0);
    expect(runner.getActiveCount()).toBe(0);
  });
});
