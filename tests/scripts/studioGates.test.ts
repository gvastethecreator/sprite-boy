import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  GATE_SCHEMA_VERSION,
  STUDIO_GATE_MANIFEST,
  parseGateArguments,
  resolveBunExecutable,
  resolveGatePlan,
  runGateCli,
  runGatePlan,
  serializeGate,
} from "../../scripts/studio-gates.mjs";
import {
  CdpClient,
  chromeExecutableCandidates,
  resolveChromeExecutable,
  resolveNodeExecutable,
  runWithBrowserRuntimeDeadline,
  safeRemoveProfile,
  spawnViteServer,
  terminateChildProcess,
  waitForExit,
} from "../../scripts/studio-browser-smoke.mjs";

const PINNED_BUN_RUNTIME = { runtimeVersion: "1.3.14", execPath: "C:/bun.exe" };

function outputBuffer() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value: string) => stdout.push(value) },
      stderr: { write: (value: string) => stderr.push(value) },
    },
  };
}

class FakeSocket {
  listeners = new Map<string, Set<(event: { data?: string }) => void>>();
  sent: string[] = [];
  closeCalls = 0;

  addEventListener(
    type: string,
    listener: (event: { data?: string }) => void,
    _options?: { once?: boolean },
  ) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {
    this.closeCalls += 1;
  }

  emit(type: string, payload: Record<string, unknown> = {}) {
    const event = type === "message" ? { data: JSON.stringify(payload) } : {};
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("studio gate manifest", () => {
  it("freezes the complete class manifest and keeps all ordered without duplicate build", () => {
    expect(GATE_SCHEMA_VERSION).toBe(1);
    expect(Object.isFrozen(STUDIO_GATE_MANIFEST)).toBe(true);
    expect(Object.isFrozen(STUDIO_GATE_MANIFEST.gates)).toBe(true);
    expect(Object.keys(STUDIO_GATE_MANIFEST.gates)).toEqual([
      "reproducibility",
      "audit",
      "typecheck",
      "lint",
      "unit",
      "contract",
      "integration",
      "coverage",
      "fixtures",
      "budgets",
      "persistence",
      "build",
      "e2e",
      "all",
    ]);
    for (const gate of Object.values(STUDIO_GATE_MANIFEST.gates)) {
      expect(Object.isFrozen(gate)).toBe(true);
      expect(Object.isFrozen(gate.steps)).toBe(true);
      expect(gate.steps.every((step) => Object.isFrozen(step) && Object.isFrozen(step.args))).toBe(true);
      expect(gate.steps.every((step) => step.command === "bun")).toBe(true);
    }

    expect(STUDIO_GATE_MANIFEST.gates.e2e.steps.map(({ id }) => id)).toEqual([
      "build",
      "browser-smoke",
    ]);
    expect(STUDIO_GATE_MANIFEST.gates.reproducibility.steps.map(({ id }) => id)).toEqual([
      "reproducibility",
    ]);
    expect(STUDIO_GATE_MANIFEST.gates.audit.steps.map(({ id }) => id)).toEqual(["audit"]);
    expect(STUDIO_GATE_MANIFEST.gates.audit.steps[0]?.args).toEqual([
      "audit", "--audit-level=high",
    ]);
    expect(STUDIO_GATE_MANIFEST.gates.all.steps.map(({ id }) => id)).toEqual([
      "reproducibility",
      "audit",
      "typecheck",
      "lint",
      "unit",
      "contract",
      "integration",
      "coverage",
      "fixtures",
      "persistence-browser",
      "build",
      "bundle-budget",
      "browser-budget",
      "deferred-feature-browser",
    ]);
    expect(STUDIO_GATE_MANIFEST.gates.all.steps.filter(({ id }) => id === "build")).toHaveLength(1);
    expect(STUDIO_GATE_MANIFEST.gates.lint.steps[0]?.args).toEqual([
      "x", "oxlint", ".", "--deny-warnings",
    ]);
    expect(STUDIO_GATE_MANIFEST.gates.budgets.steps.map(({ id }) => id)).toEqual([
      "build",
      "bundle-budget",
      "browser-budget",
      "deferred-feature-browser",
    ]);
    expect(STUDIO_GATE_MANIFEST.gates.persistence.steps.map(({ id }) => id)).toEqual([
      "persistence-browser",
    ]);
  });

  it("allowlists gate IDs and parses only explicit non-conflicting arguments", () => {
    expect(parseGateArguments(["--gate", "contract", "--dry-run"])).toEqual({
      gateId: "contract",
      list: false,
      dryRun: true,
    });
    expect(parseGateArguments(["--list"])).toEqual({ gateId: null, list: true, dryRun: false });
    expect(() => parseGateArguments([])).toThrow(/gate ID is required/);
    expect(() => parseGateArguments(["--gate"])).toThrow(/requires a gate ID/);
    expect(() => parseGateArguments(["--gate", "unit", "--list"])).toThrow(/cannot be combined/);
    expect(() => parseGateArguments(["--gate", "unit", "--gate", "build"])).toThrow(/Duplicate/);
    expect(() => parseGateArguments(["--list", "--list"])).toThrow(/Duplicate/);
    expect(() => parseGateArguments(["--dry-run", "--dry-run", "--gate", "unit"])).toThrow(/Duplicate/);
    expect(() => parseGateArguments(["--list", "--dry-run"])).toThrow(/requires --gate/);
    expect(() => parseGateArguments(["--command", "Remove-Item"])).toThrow(/Unknown/);
    expect(() => resolveGatePlan("unit; Remove-Item -Recurse")).toThrow(/Unknown studio gate ID/);
    expect(resolveGatePlan("integration")).toBe(STUDIO_GATE_MANIFEST.gates.integration);
  });

  it("serializes a data-only plan with fixed argv and timeouts", () => {
    const plan = serializeGate(resolveGatePlan("e2e"));
    expect(plan).toEqual({
      schemaVersion: 1,
      id: "e2e",
      label: "Production browser smoke",
      steps: [
        {
          id: "build",
          label: "Production build",
          command: "bun",
          args: ["x", "vite", "build"],
          timeoutMs: 180_000,
        },
        {
          id: "browser-smoke",
          label: "Production Chrome smoke",
          command: "bun",
          args: ["scripts/studio-browser-smoke.mjs"],
          timeoutMs: 90_000,
        },
      ],
    });
  });
});

describe("studio gate execution", () => {
  it("pins child execution to Bun 1.3.14 and rejects runtime or executable drift", () => {
    expect(resolveBunExecutable(PINNED_BUN_RUNTIME)).toBe("C:/bun.exe");
    expect(() => resolveBunExecutable({ runtimeVersion: "1.3.9", execPath: "C:/bun.exe" })).toThrow(/1\.3\.14/);
    expect(() => resolveBunExecutable({ runtimeVersion: "1.3.14", execPath: "C:/node.exe" })).toThrow(/executable/);
    const spawn = vi.fn();
    expect(runGatePlan(resolveGatePlan("typecheck"), {
      spawnSync: spawn,
      runtimeVersion: "1.3.9",
      execPath: "C:/bun.exe",
    })).toMatchObject({ status: "failed", reason: "bun-runtime-mismatch", failedStep: "typecheck" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns fixed argv sequentially with shell disabled and reports exact completion", () => {
    const calls: unknown[][] = [];
    const spawn = vi.fn((...args: unknown[]) => {
      calls.push(args);
      return { status: 0 };
    });
    const result = runGatePlan(resolveGatePlan("e2e"), {
      cwd: "D:/workspace",
      spawnSync: spawn,
      stdio: "pipe",
      ...PINNED_BUN_RUNTIME,
    });

    expect(result).toEqual({
      status: "passed",
      gateId: "e2e",
      completed: ["build", "browser-smoke"],
      failedStep: null,
      reason: null,
      exitCode: 0,
    });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(calls[0]?.[0]).toBe("C:/bun.exe");
    expect(calls[0]?.[1]).toEqual(["x", "vite", "build"]);
    expect(calls[0]?.[2]).toMatchObject({
      cwd: expect.stringMatching(/workspace$/),
      shell: false,
      stdio: "pipe",
      timeout: 180_000,
      windowsHide: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.completed)).toBe(true);
  });

  it("stops on the first non-zero exit or timeout without running later steps", () => {
    const nonZero = vi.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 7 });
    expect(runGatePlan(resolveGatePlan("e2e"), { spawnSync: nonZero, ...PINNED_BUN_RUNTIME })).toMatchObject({
      status: "failed",
      completed: ["build"],
      failedStep: "browser-smoke",
      reason: "non-zero-exit",
      exitCode: 7,
    });

    const timeoutError = Object.assign(new Error("private process detail"), { code: "ETIMEDOUT" });
    const timeout = vi.fn().mockReturnValue({ status: null, error: timeoutError });
    const result = runGatePlan(resolveGatePlan("all"), { spawnSync: timeout, ...PINNED_BUN_RUNTIME });
    expect(result).toMatchObject({
      status: "failed",
      completed: [],
      failedStep: "reproducibility",
      reason: "timeout",
      exitCode: 1,
    });
    expect(JSON.stringify(result)).not.toContain("private process detail");
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-zero result from every ordered all/e2e step", () => {
    const expectedSteps = {
      all: [
        "reproducibility", "audit", "typecheck", "lint", "unit", "contract", "integration",
        "coverage", "fixtures", "persistence-browser", "build", "bundle-budget", "browser-budget",
        "deferred-feature-browser",
      ],
      e2e: ["build", "browser-smoke"],
    } as const;
    for (const [gateId, stepIds] of Object.entries(expectedSteps)) {
      stepIds.forEach((stepId, index) => {
        let callCount = 0;
        const spawn = vi.fn((_: string, __: string[], _options: { cwd: string }) => {
          callCount += 1;
          return { status: callCount === index + 1 ? 9 : 0 };
        });
        const result = runGatePlan(resolveGatePlan(gateId), { spawnSync: spawn, ...PINNED_BUN_RUNTIME });
        expect(result).toMatchObject({
          status: "failed",
          failedStep: stepId,
          reason: "non-zero-exit",
          exitCode: 9,
          completed: stepIds.slice(0, index),
        });
        expect(spawn).toHaveBeenCalledTimes(index + 1);
      });
    }
  });

  it("lists and dry-runs without spawning and propagates CLI failure codes", () => {
    const listed = outputBuffer();
    const spawn = vi.fn();
    expect(runGateCli(["--list"], listed.io, { spawnSync: spawn })).toBe(0);
    const listPayload = JSON.parse(listed.stdout.join(""));
    expect(listPayload.gates.map(({ id }: { id: string }) => id)).toContain("e2e");

    const dry = outputBuffer();
    expect(runGateCli(["--gate", "integration", "--dry-run"], dry.io, { spawnSync: spawn })).toBe(0);
    expect(JSON.parse(dry.stdout.join(""))).toMatchObject({
      id: "integration",
      steps: [{ id: "integration", command: "bun" }],
    });
    expect(spawn).not.toHaveBeenCalled();

    const failed = outputBuffer();
    expect(runGateCli(["--gate", "unknown"], failed.io, { spawnSync: spawn })).toBe(2);
    expect(failed.stderr.join("")).toContain("Unknown studio gate ID");

    const execution = outputBuffer();
    const failureSpawn = vi.fn().mockReturnValue({ status: 3 });
    expect(runGateCli(["--gate", "typecheck"], execution.io, {
      spawnSync: failureSpawn,
      ...PINNED_BUN_RUNTIME,
    })).toBe(3);
    expect(JSON.parse(execution.stdout.join(""))).toMatchObject({
      status: "failed",
      failedStep: "typecheck",
      exitCode: 3,
    });
  });
});

describe("Chrome executable resolution", () => {
  it("reserves outer-gate cleanup time when the browser operation stalls", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn().mockResolvedValue(undefined);
      const pending = runWithBrowserRuntimeDeadline(
        () => new Promise(() => {}),
        cleanup,
        25,
      );
      const rejected = expect(pending).rejects.toThrow(/deadline exceeded/);

      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries temporary profile removal independently of runtime rmSync behavior", async () => {
    const remove = vi.fn()
      .mockRejectedValueOnce(new Error("locked"))
      .mockRejectedValueOnce(new Error("still locked"))
      .mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(safeRemoveProfile(join(tmpdir(), "sprite-boy-test-profile"), {
      delay: wait,
      rm: remove,
    })).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("resolves Node explicitly when the gate itself is running under Bun", () => {
    const lookup = vi.fn().mockReturnValue({
      status: 0,
      stdout: "C:/Program Files/nodejs/node.exe\r\n",
    });
    expect(resolveNodeExecutable({
      env: {},
      execPath: "C:/bun.exe",
      existsSync: (value: string) => value === "C:/Program Files/nodejs/node.exe",
      platform: "win32",
      runtimeIsBun: true,
      spawnSync: lookup,
    })).toBe("C:/Program Files/nodejs/node.exe");
    expect(lookup).toHaveBeenCalledWith(
      "where",
      ["node"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("owns the direct Vite CLI process instead of spawning through a package runner", () => {
    const child = { exitCode: null };
    const spawn = vi.fn().mockReturnValue(child);
    const result = spawnViteServer("D:/repo", 4173, "preview", {
      createRequire: () => ({
        resolve: () => "D:/repo/node_modules/vite/package.json",
      }),
      env: { MODE: "test" },
      execPath: "C:/node.exe",
      existsSync: () => true,
      spawn,
    });

    expect(result).toBe(child);
    expect(spawn).toHaveBeenCalledWith(
      "C:/node.exe",
      [
        expect.stringMatching(/vite[\\/]bin[\\/]vite\.js$/u),
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
      ],
      expect.objectContaining({
        env: { MODE: "test" },
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      }),
    );
    expect(spawn.mock.calls[0]?.[1]).not.toContain("x");
  });

  it("fails closed and escalates when a child process never exits", async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    });
    await expect(waitForExit(child, 5)).rejects.toThrow(/timed out/);
    await expect(terminateChildProcess(child, 5)).rejects.toThrow(/timed out/);
    expect(child.kill).toHaveBeenNthCalledWith(1);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("accepts PID liveness as exit proof when Bun does not publish child metadata", async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      pid: 42,
    });
    await expect(waitForExit(child, 5, {
      kill: () => {
        throw Object.assign(new Error("gone"), { code: "ESRCH" });
      },
    })).resolves.toBeUndefined();
  });

  it("builds explicit Windows, macOS and Linux candidates without shell interpolation", () => {
    const windows = chromeExecutableCandidates("win32", {
      STUDIO_CHROME_PATH: "D:/portable/chrome.exe",
      PROGRAMFILES: "C:/Program Files",
      "PROGRAMFILES(X86)": "C:/Program Files (x86)",
      LOCALAPPDATA: "C:/Users/test/AppData/Local",
    });
    expect(windows).toEqual([
      "D:/portable/chrome.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    ]);
    expect(chromeExecutableCandidates("darwin", {})).toContain(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
    expect(chromeExecutableCandidates("linux", {})).toContain("/usr/bin/chromium");
  });

  it("prefers an existing explicit path and falls back to safe PATH lookup", () => {
    const lookup = vi.fn();
    expect(resolveChromeExecutable({
      platform: "win32",
      env: { STUDIO_CHROME_PATH: "D:/chrome.exe" },
      existsSync: (value: string) => value === "D:/chrome.exe",
      spawnSync: lookup,
    })).toBe("D:/chrome.exe");
    expect(lookup).not.toHaveBeenCalled();

    const where = vi.fn().mockReturnValue({ status: 0, stdout: "C:/Chrome/chrome.exe\r\n" });
    expect(resolveChromeExecutable({
      platform: "win32",
      env: {},
      existsSync: (value: string) => value === "C:/Chrome/chrome.exe",
      spawnSync: where,
    })).toBe("C:/Chrome/chrome.exe");
    expect(where).toHaveBeenCalledWith("where", ["chrome.exe"], expect.objectContaining({ shell: false }));
  });

  it("fails safely when Chrome is unavailable", () => {
    const lookup = vi.fn().mockReturnValue({ status: 1, stdout: "private path" });
    expect(() => resolveChromeExecutable({
      platform: "linux",
      env: {},
      existsSync: () => false,
      spawnSync: lookup,
    })).toThrow("Chrome executable is unavailable.");
  });
});

describe("Chrome DevTools client", () => {
  it("rejects in-flight commands on disconnect and closes idempotently", async () => {
    const socket = new FakeSocket();
    const client = new CdpClient(socket, 1_000);
    const pending = client.send("Runtime.evaluate");
    socket.emit("close");

    await expect(pending).rejects.toThrow("Chrome connection closed");
    expect(client.pending.size).toBe(0);
    client.close();
    client.close();
    expect(socket.closeCalls).toBe(0);
  });

  it("bounds Browser.close when Chrome disconnects before replying", async () => {
    const socket = new FakeSocket();
    const client = new CdpClient(socket, 1_000);
    const closing = client.send("Browser.close");
    socket.emit("error");

    await expect(closing).rejects.toThrow("Chrome connection closed");
    expect(client.closed).toBe(true);
  });

  it("times out unanswered commands and records redacted HTTP/network failures", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const client = new CdpClient(socket, 25);
      const pending = client.send("Page.enable");
      const rejected = expect(pending).rejects.toThrow("Page.enable timed out");
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(client.pending.size).toBe(0);

      socket.emit("message", {
        method: "Network.responseReceived",
        params: { type: "Fetch", response: { status: 503, url: "https://private.invalid/token" } },
      });
      socket.emit("message", {
        method: "Network.loadingFailed",
        params: {
          requestId: "private-request-id",
          type: "Image",
          canceled: false,
          errorText: "private host detail",
        },
      });

      expect(client.httpErrorKinds).toEqual([{ type: "Fetch", status: 503 }]);
      expect(client.networkFailureKinds).toEqual([{ type: "Image", canceled: false, blocked: false }]);
      expect(JSON.stringify({
        http: client.httpErrorKinds,
        network: client.networkFailureKinds,
      })).not.toMatch(/private|token/);
    } finally {
      vi.useRealTimers();
    }
  });
});
