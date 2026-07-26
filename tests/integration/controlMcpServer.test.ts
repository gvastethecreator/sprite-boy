import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TOKEN = "mcp-test-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const ORIGIN = "http://127.0.0.1:5173";

function processEnvironment(extra: Record<string, string>): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  return { ...environment, ...extra };
}

describe.sequential("SpriteBoy MCP stdio server", () => {
  let bridge: ChildProcessWithoutNullStreams;
  let bridgeUrl: string;
  let browserClientId: string;
  let bridgeStderr = "";
  let mcpStderr = "";
  let client: Client;
  let transport: StdioClientTransport;

  const browserHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    Origin: ORIGIN,
  });

  const browserPost = (path: string, body: unknown): Promise<Response> => fetch(
    `${bridgeUrl}/v1/browser/${path}`,
    {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify(body),
    },
  );

  const poll = (): Promise<Response> => browserPost("poll", {
    version: 1,
    clientId: browserClientId,
  });

  const driveBridge = async <T>(
    operation: Promise<T>,
    expectedCommand: string,
    result: unknown,
    revision: number,
  ): Promise<{ readonly operationResult: T; readonly request: Record<string, unknown> }> => {
    const message = await poll().then((response) => response.json()) as {
      operationId: string;
      request: Record<string, unknown>;
    };
    expect(message.request.command).toBe(expectedCommand);
    const responded = await browserPost("respond", {
      version: 1,
      clientId: browserClientId,
      operationId: message.operationId,
      response: {
        version: 1,
        requestId: message.request.requestId,
        ok: true,
        revision,
        result,
      },
    });
    expect(responded.status).toBe(204);
    return { operationResult: await operation, request: message.request };
  };

  beforeAll(async () => {
    bridge = spawn(
      "bun",
      [
        "scripts/studio-control-bridge.mjs",
        "--port",
        "0",
        "--timeout-ms",
        "2000",
        "--origin",
        ORIGIN,
      ],
      {
        cwd: process.cwd(),
        env: processEnvironment({ SPRITEBOY_CONTROL_TOKEN: TOKEN }),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    bridge.stdin.end();
    bridge.stderr.setEncoding("utf8");
    bridge.stderr.on("data", (chunk: string) => {
      bridgeStderr += chunk;
    });
    const port = await new Promise<number>((resolve, reject) => {
      const lines = createInterface({ input: bridge.stdout });
      const timeout = setTimeout(() => reject(new Error(bridgeStderr)), 10_000);
      lines.once("line", (line) => {
        clearTimeout(timeout);
        lines.close();
        resolve((JSON.parse(line) as { port: number }).port);
      });
    });
    bridgeUrl = `http://127.0.0.1:${port}`;
    const connected = await browserPost("connect", { version: 1 });
    browserClientId = ((await connected.json()) as { clientId: string }).clientId;

    transport = new StdioClientTransport({
      command: "bun",
      args: ["scripts/studio-control-mcp.ts"],
      cwd: process.cwd(),
      env: processEnvironment({
        SPRITEBOY_CONTROL_TOKEN: TOKEN,
        SPRITEBOY_CONTROL_BRIDGE_URL: bridgeUrl,
      }),
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: unknown) => {
      mcpStderr += String(chunk);
    });
    client = new Client({ name: "spriteboy-mcp-test", version: "1.0.0" });
    await client.connect(transport);
  }, 20_000);

  afterAll(async () => {
    await client?.close();
    if (bridge && bridge.exitCode === null) {
      bridge.kill();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3_000);
        bridge.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  });

  it("lists the bounded tools and read-only resources over clean stdio", async () => {
    const tools = await client.listTools();
    const resources = await client.listResources();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "spriteboy_navigate",
      "spriteboy_import_asset",
      "spriteboy_import_video",
      "spriteboy_model_status",
      "spriteboy_model_setup",
      "spriteboy_jobs_list",
      "spriteboy_jobs_cancel",
      "spriteboy_export",
    ]);
    expect(resources.resources.map((resource) => resource.uri)).toEqual([
      "spriteboy://capabilities",
      "spriteboy://project",
      "spriteboy://selection",
      "spriteboy://jobs",
    ]);
    expect(transport.pid).toBeTypeOf("number");
  });

  it("maps a tool call to one revision-bound idempotent control request", async () => {
    const operation = client.callTool({
      name: "spriteboy_navigate",
      arguments: {
        workspaceId: "compose",
        expectedRevision: 4,
        idempotencyKey: "mcp-navigate-proof",
      },
    });
    const driven = await driveBridge(operation, "workspace.navigate", { workspaceId: "compose" }, 5);

    expect(driven.request).toMatchObject({
      version: 1,
      idempotencyKey: "mcp-navigate-proof",
      expectedRevision: 4,
      params: { workspaceId: "compose" },
    });
    expect(driven.operationResult).toMatchObject({
      isError: false,
      structuredContent: { ok: true, revision: 5, result: { workspaceId: "compose" } },
    });
  });

  it("reads a project resource through the same bridge", async () => {
    const operation = client.readResource({ uri: "spriteboy://project" });
    const driven = await driveBridge(
      operation,
      "project.get",
      { schemaVersion: 2, id: "project-mcp", workspace: {} },
      5,
    );
    const content = driven.operationResult.contents[0];
    expect(content).toMatchObject({ uri: "spriteboy://project", mimeType: "application/json" });
    if (!("text" in content)) throw new Error("Expected a text MCP resource.");
    expect(JSON.parse(content.text)).toMatchObject({
      ok: true,
      revision: 5,
      result: { id: "project-mcp" },
    });
  });

  it("rejects invalid tool input before it reaches the bridge", async () => {
    const result = await client.callTool({
      name: "spriteboy_navigate",
      arguments: { workspaceId: "animate", extra: true },
    });
    expect(result.isError).toBe(true);

    const status = await fetch(`${bridgeUrl}/v1/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    await expect(status.json()).resolves.toMatchObject({
      activeOperations: 0,
      queuedMessages: 0,
    });
  });

  it("keeps both stderr streams free of the session token", () => {
    expect(bridgeStderr).not.toContain(TOKEN);
    expect(mcpStderr).not.toContain(TOKEN);
  });
});
