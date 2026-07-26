import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type AcpSessionNewExample = {
  readonly jsonrpc: string;
  readonly id: number;
  readonly method: string;
  readonly params: {
    readonly cwd: string;
    readonly mcpServers: ReadonlyArray<{
      readonly name: string;
      readonly command: string;
      readonly args: readonly string[];
      readonly env: ReadonlyArray<{ readonly name: string; readonly value: string }>;
    }>;
  };
};

describe("ACP SpriteBoy client example", () => {
  it("announces the stdio MCP with absolute Windows paths and bounded loopback credentials", async () => {
    const raw = await readFile(resolve("examples/acp/spriteboy-session-new.json"), "utf8");
    const request = JSON.parse(raw) as AcpSessionNewExample;

    expect(request).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: {
        mcpServers: [{ name: "spriteboy-studio" }],
      },
    });
    expect(request.params.cwd).toMatch(/^[A-Za-z]:\\/);

    const server = request.params.mcpServers[0];
    expect(server.command).toMatch(/^[A-Za-z]:\\/);
    expect(server.args).toHaveLength(1);
    expect(server.args[0]).toMatch(/^[A-Za-z]:\\.*studio-control-mcp\.ts$/);

    const environment = Object.fromEntries(server.env.map(({ name, value }) => [name, value]));
    expect(environment.SPRITEBOY_CONTROL_BRIDGE_URL).toBe("http://127.0.0.1:43119");
    expect(environment.SPRITEBOY_CONTROL_TOKEN).toBe("<inject-SPRITEBOY_CONTROL_TOKEN-at-runtime>");
    expect(Object.keys(environment).sort()).toEqual([
      "SPRITEBOY_CONTROL_BRIDGE_URL",
      "SPRITEBOY_CONTROL_TOKEN",
    ]);
  });
});
