import { describe, expect, it, vi } from "vitest";
import {
  createLocalModelServiceClient,
  LocalModelServiceError,
} from "../../core/models/localModelServiceClient";
import { createQueuedJob } from "../../core/processing";

const TOKEN = "model-client-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const JOB = createQueuedJob({
  id: "model-job/one",
  requestId: "model-request-one",
  kind: "model.setup",
  label: "Prepare local model",
  createdAt: "2026-07-26T03:00:00.000Z",
  timeoutMs: 30_000,
});

describe("local model service client", () => {
  it("sends the in-memory token only to a loopback origin", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      version: 1,
      models: [{ id: "birefnet-lite-512" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: fetchMock as typeof fetch,
    });
    await expect(client.list()).resolves.toMatchObject({ version: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43119/v1/models",
      expect.objectContaining({
        cache: "no-store",
        method: "GET",
        credentials: "omit",
        headers: { Authorization: `Bearer ${TOKEN}` },
        referrerPolicy: "no-referrer",
      }),
    );
    expect(() => createLocalModelServiceClient({
      baseUrl: "https://models.example",
      token: TOKEN,
    })).toThrow("URL is invalid");
  });

  it("keeps typed service failures bounded", async () => {
    const client = createLocalModelServiceClient({
      baseUrl: "http://localhost:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response(JSON.stringify({
        version: 1,
        error: { code: "license-required", message: "License approval required." },
      }), { status: 409, headers: { "Content-Type": "application/json" } })) as typeof fetch,
    });
    await expect(client.setup("rmbg-2.0")).rejects.toMatchObject({
      name: "LocalModelServiceError",
      code: "license-required",
      message: "License approval required.",
    });
  });

  it("posts an exact versioned setup request with JSON headers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      version: 1,
      modelId: "rmbg-2.0",
      outcome: "started",
      job: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const service = createLocalModelServiceClient({
      baseUrl: "http://localhost:43119",
      token: TOKEN,
      fetch: fetchMock,
    });

    await expect(service.setup("rmbg-2.0")).resolves.toMatchObject({ outcome: "started" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:43119/v1/models/setup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ version: 1, modelId: "rmbg-2.0" }),
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("rejects invalid JSON and reads verified weight bytes", async () => {
    const invalid = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    await expect(invalid.list()).rejects.toBeInstanceOf(LocalModelServiceError);

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const weights = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response(bytes, { status: 200 })) as typeof fetch,
    });
    await expect(weights.getWeights("birefnet-lite-512")).resolves.toEqual(bytes.buffer);
  });

  it.each([
    ["models", { version: 2, models: [] }],
    ["models", { version: 1, models: {} }],
    ["models", { version: 1, models: [{ id: "unknown-model" }] }],
    ["setup", { version: 1, modelId: "rmbg-2.0", outcome: "finished" }],
  ] as const)("rejects malformed response schemas for %s", async (operation, payload) => {
    const service = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
    });

    const request = operation === "setup" ? service.setup("rmbg-2.0") : service.list();
    await expect(request).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("maps authentication, malformed HTTP errors, aborts and network failures", async () => {
    const unauthorized = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response("private", { status: 401 })) as typeof fetch,
    });
    const malformed = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response(JSON.stringify({
        version: 1,
        error: { code: "private-stack", message: "do not expose" },
      }), { status: 500 })) as typeof fetch,
    });
    const controller = new AbortController();
    controller.abort();
    const abortedFetch = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as unknown as typeof fetch;
    const aborted = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: abortedFetch,
    });
    const network = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => {
        throw new TypeError("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
    });

    await expect(unauthorized.list()).rejects.toMatchObject({ code: "authentication" });
    await expect(malformed.list()).rejects.toMatchObject({
      code: "invalid-response",
      message: "The local model service rejected the request.",
    });
    await expect(aborted.list(controller.signal)).rejects.toMatchObject({ code: "connection" });
    expect(abortedFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:43119/v1/models",
      expect.objectContaining({ signal: controller.signal }),
    );
    await expect(network.list()).rejects.toMatchObject({ code: "connection" });
  });

  it("rejects an unreadable weights response", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]));
    vi.spyOn(response, "arrayBuffer").mockRejectedValue(new TypeError("stream failed"));
    const service = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => response) as unknown as typeof fetch,
    });

    await expect(service.getWeights("birefnet-lite-512")).rejects.toMatchObject({
      code: "invalid-response",
      message: "The local model weights could not be read.",
    });
  });

  it("reads the model job registry for MCP job federation", async () => {
    const snapshot = {
      jobs: {},
      order: [],
      retiredRequestIds: [],
      retiredJobIds: [],
      consumedRetrySourceIds: [],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: 1, snapshot }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const client = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: fetchMock,
    });

    await expect(client.listJobs()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43119/v1/models/jobs",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates, freezes and routes individual job reads and cancellation", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      version: 1,
      job: JOB,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const service = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: fetchMock,
    });

    await expect(service.getJob(JOB.id)).resolves.toEqual(JOB);
    await expect(service.cancelJob(JOB.id)).resolves.toEqual(JOB);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43119/v1/models/jobs/model-job%2Fone",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:43119/v1/models/jobs/model-job%2Fone",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns an immutable valid job registry and rejects registry identity drift", async () => {
    const validSnapshot = {
      jobs: { [JOB.id]: JOB },
      order: [JOB.id],
      retiredRequestIds: ["retired-request"],
      retiredJobIds: ["retired-job"],
      consumedRetrySourceIds: ["retry-source"],
    };
    const valid = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response(JSON.stringify({ version: 1, snapshot: validSnapshot }))) as typeof fetch,
    });
    const result = await valid.listJobs();

    expect(result).toEqual(validSnapshot);
    expect([result, result.jobs, result.order, result.retiredRequestIds, result.retiredJobIds,
      result.consumedRetrySourceIds].every(Object.isFrozen)).toBe(true);

    const mismatched = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response(JSON.stringify({
        version: 1,
        snapshot: { ...validSnapshot, jobs: { "other-key": JOB } },
      }))) as typeof fetch,
    });
    await expect(mismatched.listJobs()).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("rejects malformed model job registries before federation", async () => {
    const client = createLocalModelServiceClient({
      baseUrl: "http://127.0.0.1:43119",
      token: TOKEN,
      fetch: vi.fn(async () => new Response(JSON.stringify({
        version: 1,
        snapshot: {
          jobs: { "model-job": { id: "model-job", status: "running" } },
          order: ["model-job"],
          retiredRequestIds: [],
          retiredJobIds: [],
          consumedRetrySourceIds: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch,
    });

    await expect(client.listJobs()).rejects.toMatchObject({
      code: "invalid-response",
      message: "The local model service returned invalid jobs data.",
    });
  });
});
