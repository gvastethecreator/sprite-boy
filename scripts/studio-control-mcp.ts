#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import {
  parseStudioControlRequest,
  serializeStudioControlResponse,
  type StudioControlCommand,
  type StudioControlRequest,
  type StudioControlResponse,
} from "../core/control/controlProtocol";
import { LOCAL_MODEL_IDS } from "../core/models/modelCatalog";

const MCP_SERVER_NAME = "spriteboy-studio";
const MCP_SERVER_VERSION = "1.0.0";
const DEFAULT_BRIDGE_URL = "http://127.0.0.1:43119";
const BRIDGE_TIMEOUT_MS = 120_000;
const MAX_BRIDGE_RESPONSE_BYTES = 8_388_608;
const GENERIC_BRIDGE_ERROR = "The SpriteBoy control bridge is unavailable.";

function normalizeBridgeUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value || DEFAULT_BRIDGE_URL);
  } catch {
    throw new TypeError("SPRITEBOY_CONTROL_BRIDGE_URL is invalid.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new TypeError("SPRITEBOY_CONTROL_BRIDGE_URL must be a loopback HTTP origin.");
  }
  return url.origin;
}

function readToken(value: string | undefined): string {
  if (!value || value.length < 32 || value.length > 512) {
    throw new TypeError("SPRITEBOY_CONTROL_TOKEN must contain 32 to 512 characters.");
  }
  return value;
}

function requestIdentity(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BRIDGE_RESPONSE_BYTES) {
    throw new Error(GENERIC_BRIDGE_ERROR);
  }
  if (response.body === null) throw new Error(GENERIC_BRIDGE_ERROR);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BRIDGE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(GENERIC_BRIDGE_ERROR);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    throw new Error(GENERIC_BRIDGE_ERROR);
  }
}

function createControlRequest(
  command: StudioControlCommand,
  params: Record<string, unknown>,
  input: { readonly expectedRevision?: number | null; readonly idempotencyKey?: string },
): StudioControlRequest {
  return parseStudioControlRequest({
    version: 1,
    requestId: requestIdentity("mcp-request"),
    idempotencyKey: input.idempotencyKey ?? requestIdentity("mcp-idempotency"),
    command,
    expectedRevision: input.expectedRevision ?? null,
    params,
  });
}

function createBridgeCaller(baseUrl: string, token: string) {
  return async (
    request: StudioControlRequest,
    callerSignal?: AbortSignal,
  ): Promise<StudioControlResponse> => {
    const timeout = AbortSignal.timeout(BRIDGE_TIMEOUT_MS);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/control`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch {
      throw new Error(GENERIC_BRIDGE_ERROR);
    }
    if (response.status !== 200) throw new Error(GENERIC_BRIDGE_ERROR);
    const text = await readBoundedResponse(response);
    let value: unknown;
    try {
      value = JSON.parse(text);
      return JSON.parse(serializeStudioControlResponse(value)) as StudioControlResponse;
    } catch {
      throw new Error(GENERIC_BRIDGE_ERROR);
    }
  };
}

const commonInput = {
  expectedRevision: z.number().int().nonnegative().nullable().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
};

function toolResult(response: StudioControlResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(response) }],
    structuredContent: response,
    isError: !response.ok,
  };
}

function bridgeErrorResult() {
  return {
    content: [{ type: "text" as const, text: GENERIC_BRIDGE_ERROR }],
    isError: true,
  };
}

async function main(): Promise<void> {
  const baseUrl = normalizeBridgeUrl(process.env.SPRITEBOY_CONTROL_BRIDGE_URL);
  const token = readToken(process.env.SPRITEBOY_CONTROL_TOKEN);
  const callBridge = createBridgeCaller(baseUrl, token);
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });

  const registerResource = (
    name: string,
    uri: string,
    title: string,
    description: string,
    command: "capabilities.get" | "project.get" | "selection.get" | "jobs.list",
  ): void => {
    server.registerResource(
      name,
      uri,
      { title, description, mimeType: "application/json" },
      async (resourceUrl, extra) => {
        let text: string;
        try {
          const response = await callBridge(createControlRequest(command, {}, {}), extra.signal);
          text = JSON.stringify(response);
        } catch {
          text = JSON.stringify({ ok: false, error: { code: "bridge-unavailable" } });
        }
        return { contents: [{ uri: resourceUrl.href, mimeType: "application/json", text }] };
      },
    );
  };

  registerResource(
    "spriteboy-capabilities",
    "spriteboy://capabilities",
    "SpriteBoy capabilities",
    "Protocol version and commands exposed by the connected Studio session.",
    "capabilities.get",
  );
  registerResource(
    "spriteboy-project",
    "spriteboy://project",
    "SpriteBoy project",
    "Current canonical project snapshot and revision.",
    "project.get",
  );
  registerResource(
    "spriteboy-selection",
    "spriteboy://selection",
    "SpriteBoy selection",
    "Current durable Studio selection.",
    "selection.get",
  );
  registerResource(
    "spriteboy-jobs",
    "spriteboy://jobs",
    "SpriteBoy jobs",
    "Current local job state.",
    "jobs.list",
  );

  server.registerTool(
    "spriteboy_navigate",
    {
      title: "Open a SpriteBoy workspace",
      description: "Open Slice, Compose, Collision, or Export in the connected Studio tab.",
      inputSchema: z.object({
        workspaceId: z.enum(["slice", "compose", "collision", "export"]),
        ...commonInput,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input, extra) => {
      try {
        return toolResult(await callBridge(createControlRequest(
          "workspace.navigate",
          { workspaceId: input.workspaceId },
          input,
        ), extra.signal));
      } catch {
        return bridgeErrorResult();
      }
    },
  );

  server.registerTool(
    "spriteboy_import_asset",
    {
      title: "Import an image into SpriteBoy",
      description: "Import an absolute PNG, JPEG, or WebP path from a bridge --file-root (10 MiB max).",
      inputSchema: z.object({ path: z.string().min(1).max(4096), ...commonInput }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input, extra) => {
      try {
        return toolResult(await callBridge(createControlRequest(
          "asset.import",
          { path: input.path },
          input,
        ), extra.signal));
      } catch {
        return bridgeErrorResult();
      }
    },
  );

  server.registerTool(
    "spriteboy_import_video",
    {
      title: "Import video frames into SpriteBoy",
      description: "Queue frame extraction from an absolute path under a bridge --file-root (256 MiB max).",
      inputSchema: z.object({
        path: z.string().min(1).max(4096),
        startUs: z.number().int().nonnegative(),
        endUs: z.number().int().positive(),
        sampling: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("all") }).strict(),
          z.object({ mode: z.literal("fps"), fps: z.number().min(0.1).max(120) }).strict(),
        ]),
        ...commonInput,
      }).strict().refine((value) => value.endUs > value.startUs, {
        message: "endUs must be greater than startUs",
        path: ["endUs"],
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input, extra) => {
      try {
        return toolResult(await callBridge(createControlRequest(
          "video.import",
          {
            path: input.path,
            startUs: input.startUs,
            endUs: input.endUs,
            sampling: input.sampling,
          },
          input,
        ), extra.signal));
      } catch {
        return bridgeErrorResult();
      }
    },
  );

  server.registerTool(
    "spriteboy_model_status",
    {
      title: "Check a SpriteBoy local model",
      description: "Read verified local setup state for BiRefNet Lite, BEN2 Base or RMBG 2.0.",
      inputSchema: z.object({
        modelId: z.enum(LOCAL_MODEL_IDS),
        ...commonInput,
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input, extra) => {
      try {
        return toolResult(await callBridge(createControlRequest(
          "model.status",
          { modelId: input.modelId },
          input,
        ), extra.signal));
      } catch {
        return bridgeErrorResult();
      }
    },
  );

  server.registerTool(
    "spriteboy_model_setup",
    {
      title: "Set up a SpriteBoy local model",
      description: "Start verified local model setup. BEN2 Base is optional; RMBG 2.0 still requires explicit license acceptance.",
      inputSchema: z.object({
        modelId: z.enum(LOCAL_MODEL_IDS),
        acceptLicense: z.boolean(),
        ...commonInput,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input, extra) => {
      try {
        return toolResult(await callBridge(createControlRequest(
          "model.setup",
          { modelId: input.modelId, acceptLicense: input.acceptLicense },
          input,
        ), extra.signal));
      } catch {
        return bridgeErrorResult();
      }
    },
  );

  server.registerTool(
    "spriteboy_jobs_list",
    {
      title: "List SpriteBoy jobs",
      description: "List current and recent jobs in the connected Studio session.",
      inputSchema: z.object(commonInput).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input, extra) => {
      try {
        return toolResult(await callBridge(
          createControlRequest("jobs.list", {}, input),
          extra.signal,
        ));
      } catch {
        return bridgeErrorResult();
      }
    },
  );

  server.registerTool(
    "spriteboy_jobs_cancel",
    {
      title: "Cancel a SpriteBoy job",
      description: "Cancel one active Studio job by ID.",
      inputSchema: z.object({ jobId: z.string().min(1).max(128), ...commonInput }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (input, extra) => {
      try {
        return toolResult(await callBridge(createControlRequest(
          "jobs.cancel",
          { jobId: input.jobId },
          input,
        ), extra.signal));
      } catch {
        return bridgeErrorResult();
      }
    },
  );

  server.registerTool(
    "spriteboy_export",
    {
      title: "Export from SpriteBoy",
      description: "Reserved export command; the current browser capabilities omit it until artifact receipts are wired.",
      inputSchema: z.object({
        format: z.enum(["png", "zip", "gif", "mp4", "webm"]),
        ...commonInput,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input, extra) => {
      try {
        return toolResult(await callBridge(createControlRequest(
          "export.run",
          { format: input.format },
          input,
        ), extra.signal));
      } catch {
        return bridgeErrorResult();
      }
    },
  );

  const transport = new StdioServerTransport();
  process.once("SIGINT", () => void server.close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void server.close().finally(() => process.exit(0)));
  await server.connect(transport);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "SpriteBoy MCP failed to start.";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
