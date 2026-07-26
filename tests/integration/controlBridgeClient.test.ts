import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createStudioControlBridgeClient } from "../../core/control/controlBridgeClient";
import {
  createStudioControlService,
  type StudioControlPortContext,
  type StudioControlPortResult,
  type StudioControlPorts,
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
