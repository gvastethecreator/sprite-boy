import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createStudioControlBridgeClient } from "../../core/control/controlBridgeClient";
import {
  createStudioControlService,
  type StudioControlPortContext,
  type StudioControlPortResult,
  type StudioControlPorts,
  type StudioControlService,
} from "../../core/control/controlService";

const TOKEN = "client-test-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const ORIGIN = "http://127.0.0.1:5173";

function ports(getProject: StudioControlPorts["getProject"]): StudioControlPorts {
  const unsupported = (): StudioControlPortResult => ({
    ok: false,
    revision: 2,
    error: { code: "unsupported-command", message: "Unavailable.", retryable: false },
  });
  return {
    getRevision: vi.fn(() => 2),
    getProject,
    getSelection: unsupported,
    navigate: unsupported,
    importAsset: unsupported,
    importVideo: unsupported,
    getModelStatus: unsupported,
    setupModel: unsupported,
    listJobs: unsupported,
    cancelJob: unsupported,
    runExport: unsupported,
  };
}

function request(requestId: string): Record<string, unknown> {
  return {
    version: 1,
    requestId,
    idempotencyKey: requestId,
    command: "project.get",
    expectedRevision: null,
    params: {},
  };
}

function serviceStub(): StudioControlService {
  return {
    disposed: false,
    execute: vi.fn(),
    cancel: vi.fn(() => false),
    dispose: vi.fn(),
  };
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

describe.sequential("StudioControlBridgeClient with loopback bridge", () => {
  let child: ChildProcessWithoutNullStreams;
  let baseUrl: string;
  let stderr = "";

  const browserFetch: typeof globalThis.fetch = (input, init) => {
    const requestHeaders = new Headers(init?.headers);
    requestHeaders.set("Origin", ORIGIN);
    return globalThis.fetch(input, { ...init, headers: requestHeaders });
  };

  beforeAll(async () => {
    child = spawn(
      "bun",
      [
        "scripts/studio-control-bridge.mjs",
        "--port",
        "0",
        "--timeout-ms",
        "500",
        "--origin",
        ORIGIN,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, SPRITEBOY_CONTROL_TOKEN: TOKEN },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.stdin.end();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const port = await new Promise<number>((resolve, reject) => {
      const lines = createInterface({ input: child.stdout });
      const timeout = setTimeout(() => reject(new Error(stderr)), 10_000);
      lines.once("line", (line) => {
        clearTimeout(timeout);
        lines.close();
        const ready = JSON.parse(line) as { port: number };
        resolve(ready.port);
      });
      child.once("exit", (code) => reject(new Error(`Bridge exited: ${String(code)} ${stderr}`)));
    });
    baseUrl = `http://127.0.0.1:${port}`;
  }, 15_000);

  afterAll(async () => {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  });

  it("executes a real controller request through browser polling", async () => {
    const service = createStudioControlService({
      ports: ports(() => ({
        ok: true,
        revision: 2,
        result: { projectId: "project-live" },
      })),
    });
    const client = createStudioControlBridgeClient({
      baseUrl,
      token: TOKEN,
      service,
      fetch: browserFetch,
    });
    const states: string[] = [];
    client.subscribe(() => states.push(client.getSnapshot().status));
    await client.start();

    const response = await fetch(`${baseUrl}/v1/control`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request("client-forward")),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      requestId: "client-forward",
      ok: true,
      revision: 2,
      result: { projectId: "project-live" },
    });
    expect(states).toContain("connecting");
    expect(client.getSnapshot()).toMatchObject({ status: "connected", activeOperations: 0 });
    await client.stop();
    expect(client.getSnapshot()).toMatchObject({ status: "idle", clientId: null });
  });

  it("cancels service work after a controller timeout", async () => {
    let context: StudioControlPortContext | undefined;
    const pending = new Promise<StudioControlPortResult>(() => undefined);
    const service = createStudioControlService({
      ports: ports((value) => {
        context = value;
        return pending;
      }),
    });
    const client = createStudioControlBridgeClient({
      baseUrl,
      token: TOKEN,
      service,
      fetch: browserFetch,
    });
    await client.start();

    const response = await fetch(`${baseUrl}/v1/control`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request("client-timeout")),
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "timeout" },
    });
    await waitFor(() => expect(context?.signal.aborted).toBe(true));
    await waitFor(() => expect(client.getSnapshot().activeOperations).toBe(0));

    await client.stop();
    expect(stderr).not.toContain(TOKEN);
  });
});

describe("StudioControlBridgeClient guards", () => {
  it("rejects unsafe bridge locations and malformed dependencies", () => {
    const service = serviceStub();
    const valid = { baseUrl: "http://127.0.0.1:5173", token: TOKEN, service };

    expect(() => createStudioControlBridgeClient(null as never)).toThrow(/options are invalid/);
    for (const baseUrl of [
      "invalid",
      "https://127.0.0.1:5173",
      "http://192.168.1.3:5173",
      "http://user@localhost:5173",
      "http://localhost:5173/path",
      "http://localhost:5173/?query=1",
      "http://localhost:5173/#hash",
    ]) {
      expect(() => createStudioControlBridgeClient({ ...valid, baseUrl })).toThrow(/options are invalid/);
    }
    expect(() => createStudioControlBridgeClient({ ...valid, token: "short" })).toThrow(/options are invalid/);
    expect(() => createStudioControlBridgeClient({ ...valid, token: "x".repeat(513) })).toThrow(/options are invalid/);
    expect(() => createStudioControlBridgeClient({ ...valid, service: null as never })).toThrow(/options are invalid/);
    expect(() => createStudioControlBridgeClient({
      ...valid,
      service: { execute: vi.fn() } as never,
    })).toThrow(/options are invalid/);
    expect(() => createStudioControlBridgeClient({ ...valid, fetch: 1 as never })).toThrow(/options are invalid/);
  });

  it.each([
    ["network failure", () => Promise.reject(new Error("offline")), "could not connect"],
    ["authentication rejection", () => Promise.resolve(new Response(null, { status: 401 })), "rejected the session token"],
    ["session rejection", () => Promise.resolve(new Response(null, { status: 503 })), "could not connect"],
    ["malformed response", () => Promise.resolve(new Response("invalid-json", { status: 200 })), "could not connect"],
    ["wrong protocol version", () => Promise.resolve(Response.json({ version: 2, clientId: "client-1" })), "could not connect"],
    ["empty client identity", () => Promise.resolve(Response.json({ version: 1, clientId: "" })), "could not connect"],
    ["unexpected response field", () => Promise.resolve(Response.json({ version: 1, clientId: "client-1", extra: true })), "could not connect"],
  ])("reports %s during start", async (_label, implementation, expectedMessage) => {
    const fetchImplementation = vi.fn(implementation) as unknown as typeof globalThis.fetch;
    const client = createStudioControlBridgeClient({
      baseUrl: "http://localhost:5173/",
      token: TOKEN,
      service: serviceStub(),
      fetch: fetchImplementation,
    });

    await expect(client.start()).rejects.toThrow(expectedMessage);
    expect(client.getSnapshot()).toMatchObject({ status: "error", clientId: null });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    await client.stop();
    expect(client.getSnapshot().status).toBe("idle");
  });
});
