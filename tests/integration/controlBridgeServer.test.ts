import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TOKEN = "bridge-test-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const ORIGIN = "http://127.0.0.1:5173";

interface ReadyMessage {
  readonly type: "spriteboy-control-ready";
  readonly port: number;
  readonly sessionId: string;
  readonly allowedOrigins: readonly string[];
}

function controlRequest(
  requestId: string,
  idempotencyKey = requestId,
): Record<string, unknown> {
  return {
    version: 1,
    requestId,
    idempotencyKey,
    command: "project.get",
    expectedRevision: null,
    params: {},
  };
}

describe.sequential("studio control loopback bridge", () => {
  let child: ChildProcessWithoutNullStreams;
  let baseUrl: string;
  let clientId: string;
  let stderr = "";
  let modelsRoot: string;
  let imagePath: string;
  let outsideRoot: string;
  let outsidePath: string;
  let oversizePath: string;
  let secretPath: string;

  const headers = (token = TOKEN, origin?: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(origin ? { Origin: origin } : {}),
  });

  const browserPost = (path: string, body: unknown): Promise<Response> => fetch(
    `${baseUrl}/v1/browser/${path}`,
    {
      method: "POST",
      headers: headers(TOKEN, ORIGIN),
      body: JSON.stringify(body),
    },
  );

  const poll = (): Promise<Response> => browserPost("poll", {
    version: 1,
    clientId,
  });

  const control = (
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> => fetch(`${baseUrl}/v1/control`, {
    method: "POST",
    headers: headers(),
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });

  beforeAll(async () => {
    modelsRoot = await mkdtemp(join(tmpdir(), "spriteboy-bridge-models-"));
    outsideRoot = await mkdtemp(join(tmpdir(), "spriteboy-bridge-outside-"));
    imagePath = join(modelsRoot, "sprite.png");
    outsidePath = join(outsideRoot, "private.png");
    oversizePath = join(modelsRoot, "oversize.png");
    secretPath = join(modelsRoot, ".env");
    await writeFile(imagePath, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await writeFile(outsidePath, new Uint8Array([1, 2, 3]));
    await writeFile(oversizePath, new Uint8Array([1]));
    await truncate(oversizePath, 10 * 1024 * 1024 + 1);
    await writeFile(secretPath, "SPRITEBOY_SECRET=must-not-leak");
    child = spawn(
      "bun",
      [
        "scripts/studio-control-bridge.mjs",
        "--port",
        "0",
        "--timeout-ms",
        "180",
        "--origin",
        ORIGIN,
        "--models-dir",
        modelsRoot,
        "--file-root",
        modelsRoot,
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
    const ready = await new Promise<ReadyMessage>((resolve, reject) => {
      const output = createInterface({ input: child.stdout });
      const timeout = setTimeout(() => reject(new Error(`Bridge startup timed out: ${stderr}`)), 10_000);
      output.once("line", (line) => {
        clearTimeout(timeout);
        output.close();
        try {
          resolve(JSON.parse(line) as ReadyMessage);
        } catch (error) {
          reject(error);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Bridge exited before ready (${String(code)}): ${stderr}`));
      });
    });
    expect(ready.type).toBe("spriteboy-control-ready");
    expect(ready.port).toBeGreaterThan(0);
    expect(ready.sessionId).toMatch(/^[a-f0-9]{24}$/);
    expect(ready.allowedOrigins).toEqual([ORIGIN]);
    baseUrl = `http://127.0.0.1:${ready.port}`;
  }, 15_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    if (modelsRoot) await rm(modelsRoot, { recursive: true, force: true });
    if (outsideRoot) await rm(outsideRoot, { recursive: true, force: true });
  });

  it("binds a minimal health endpoint and hides session state without auth", async () => {
    const health = await fetch(`${baseUrl}/health`);
    const status = await fetch(`${baseUrl}/v1/status`);

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });
    expect(status.status).toBe(401);
    expect(status.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a wrong token, origin, path, and oversized body", async () => {
    const wrongToken = await fetch(`${baseUrl}/v1/status`, {
      headers: headers("x".repeat(40)),
    });
    const wrongOrigin = await fetch(`${baseUrl}/v1/browser/connect`, {
      method: "POST",
      headers: headers(TOKEN, "https://evil.example"),
      body: JSON.stringify({ version: 1 }),
    });
    const wrongPath = await fetch(`${baseUrl}/v1/browser/unknown`, {
      method: "POST",
      headers: headers(TOKEN, ORIGIN),
      body: "{}",
    });
    const oversized = await control("x".repeat(1_048_577));

    expect(wrongToken.status).toBe(401);
    expect(wrongOrigin.status).toBe(403);
    expect(wrongPath.status).toBe(404);
    expect(oversized.status).toBe(413);
    expect(await wrongToken.text()).not.toContain(TOKEN);
  });

  it("reports local model readiness and enforces license and ready gates", async () => {
    const modelHeaders = headers(TOKEN, ORIGIN);
    const listed = await fetch(`${baseUrl}/v1/models`, { headers: modelHeaders });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      version: 1,
      models: [
        { id: "birefnet-lite-512", status: { state: "absent" } },
        { id: "ben2-base", status: { state: "absent" } },
        { id: "rmbg-2.0", status: { state: "license-required" } },
      ],
    });

    const licenseBlocked = await fetch(`${baseUrl}/v1/models/setup`, {
      method: "POST",
      headers: modelHeaders,
      body: JSON.stringify({ version: 1, modelId: "rmbg-2.0" }),
    });
    expect(licenseBlocked.status).toBe(409);
    await expect(licenseBlocked.json()).resolves.toMatchObject({
      error: { code: "license-required" },
    });

    const weightsBlocked = await fetch(`${baseUrl}/v1/models/weights/birefnet-lite-512`, {
      headers: modelHeaders,
    });
    expect(weightsBlocked.status).toBe(409);
    await expect(weightsBlocked.json()).resolves.toMatchObject({
      error: { code: "model-not-ready" },
    });

    const jobs = await fetch(`${baseUrl}/v1/models/jobs`, { headers: modelHeaders });
    expect(jobs.status).toBe(200);
    await expect(jobs.json()).resolves.toMatchObject({
      version: 1,
      snapshot: { order: [], jobs: {} },
    });

    const wrongOrigin = await fetch(`${baseUrl}/v1/models`, {
      headers: headers(TOKEN, "https://evil.example"),
    });
    expect(wrongOrigin.status).toBe(403);
  });

  it("serves only bounded regular files from explicit roots", async () => {
    const fileHeaders = headers(TOKEN, ORIGIN);
    const read = (path: string, kind = "image") => fetch(`${baseUrl}/v1/files/read`, {
      method: "POST",
      headers: fileHeaders,
      body: JSON.stringify({ version: 1, path, kind }),
    });

    const image = await read(imagePath);
    expect(image.status).toBe(200);
    expect(image.headers.get("x-spriteboy-file-name")).toBe("sprite.png");
    expect(image.headers.get("x-spriteboy-mime-type")).toBe("image/png");
    expect(image.headers.get("x-spriteboy-file-size")).toBe("8");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const relative = await read("sprite.png");
    const outside = await read(outsidePath);
    const directory = await read(modelsRoot);
    const oversize = await read(oversizePath);
    const secret = await read(secretPath, "video");
    const wrongOrigin = await fetch(`${baseUrl}/v1/files/read`, {
      method: "POST",
      headers: headers(TOKEN, "https://evil.example"),
      body: JSON.stringify({ version: 1, path: imagePath, kind: "image" }),
    });

    expect(relative.status).toBe(400);
    expect(outside.status).toBe(403);
    expect(directory.status).toBe(400);
    expect(oversize.status).toBe(413);
    expect(secret.status).toBe(415);
    expect(wrongOrigin.status).toBe(403);
    await expect(outside.json()).resolves.toMatchObject({ error: { code: "outside-root" } });
    expect(await secret.text()).not.toContain("must-not-leak");
  });

  it("connects one browser session and reports it", async () => {
    const connected = await browserPost("connect", { version: 1 });
    expect(connected.status).toBe(200);
    const body = await connected.json() as { version: number; clientId: string };
    clientId = body.clientId;
    expect(body.version).toBe(1);
    expect(clientId).toMatch(/^[a-f0-9]{32}$/);

    const busy = await browserPost("connect", { version: 1 });
    expect(busy.status).toBe(409);

    const status = await fetch(`${baseUrl}/v1/status`, { headers: headers() });
    await expect(status.json()).resolves.toMatchObject({
      version: 1,
      browserConnected: true,
      activeOperations: 0,
    });
  });

  it("forwards one request and returns the matching browser response", async () => {
    const pendingPoll = poll();
    const pendingControl = control(controlRequest("forward-1"));
    const delivered = await pendingPoll;
    expect(delivered.status).toBe(200);
    const message = await delivered.json() as {
      version: number;
      type: string;
      operationId: string;
      request: Record<string, unknown>;
    };
    expect(message).toMatchObject({
      version: 1,
      type: "control.request",
      request: { requestId: "forward-1", command: "project.get" },
    });

    const responded = await browserPost("respond", {
      version: 1,
      clientId,
      operationId: message.operationId,
      response: {
        version: 1,
        requestId: "forward-1",
        ok: true,
        revision: 4,
        result: { projectId: "project-1" },
      },
    });
    expect(responded.status).toBe(204);

    const result = await pendingControl;
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({
      version: 1,
      requestId: "forward-1",
      ok: true,
      revision: 4,
      result: { projectId: "project-1" },
    });
  });

  it("rejects a mismatched response and lets the browser retry", async () => {
    const pendingPoll = poll();
    const pendingControl = control(controlRequest("retry-response"));
    const message = await pendingPoll.then((response) => response.json()) as {
      operationId: string;
    };
    const mismatch = await browserPost("respond", {
      version: 1,
      clientId,
      operationId: message.operationId,
      response: {
        version: 1,
        requestId: "wrong-request",
        ok: true,
        revision: 4,
        result: null,
      },
    });
    expect(mismatch.status).toBe(400);

    const retry = await browserPost("respond", {
      version: 1,
      clientId,
      operationId: message.operationId,
      response: {
        version: 1,
        requestId: "retry-response",
        ok: false,
        revision: 4,
        error: { code: "not-found", message: "Missing.", retryable: false },
      },
    });
    expect(retry.status).toBe(204);
    await expect(pendingControl.then((response) => response.json())).resolves.toMatchObject({
      ok: false,
      requestId: "retry-response",
      error: { code: "not-found" },
    });
  });

  it("times out delivered work and sends a cancel message", async () => {
    const pendingPoll = poll();
    const pendingControl = control(controlRequest("timeout-1"));
    const delivered = await pendingPoll.then((response) => response.json()) as {
      operationId: string;
      type: string;
    };
    expect(delivered.type).toBe("control.request");

    const timedOut = await pendingControl;
    await expect(timedOut.json()).resolves.toMatchObject({
      ok: false,
      requestId: "timeout-1",
      error: { code: "timeout", retryable: true },
    });
    const cancelled = await poll();
    await expect(cancelled.json()).resolves.toEqual({
      version: 1,
      type: "control.cancel",
      operationId: delivered.operationId,
    });
  });

  it("disconnect invalidates the session and cancels active work", async () => {
    const pendingPoll = poll();
    const pendingControl = control(controlRequest("disconnect-1"));
    await pendingPoll;

    const disconnected = await browserPost("disconnect", { version: 1, clientId });
    expect(disconnected.status).toBe(204);
    await expect(pendingControl.then((response) => response.json())).resolves.toMatchObject({
      ok: false,
      requestId: "disconnect-1",
      error: { code: "cancelled" },
    });

    const noBrowser = await control(controlRequest("after-disconnect"));
    await expect(noBrowser.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "busy" },
    });
  });

  it("keeps audit output free of the session token", () => {
    expect(stderr).toContain("spriteboy-control-audit");
    expect(stderr).not.toContain(TOKEN);
  });
});
