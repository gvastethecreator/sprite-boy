import { describe, expect, it } from "vitest";
import {
  STUDIO_CONTROL_COMMANDS,
  STUDIO_CONTROL_MAX_REQUEST_BYTES,
  STUDIO_CONTROL_PROTOCOL_VERSION,
  createStudioControlFailure,
  createStudioControlSuccess,
  parseStudioControlRequest,
  parseStudioControlRequestJson,
  serializeStudioControlResponse,
  type StudioControlCommand,
  type StudioControlRequest,
} from "../../core/control/controlProtocol";

const BASE = {
  version: STUDIO_CONTROL_PROTOCOL_VERSION,
  requestId: "req-1",
  idempotencyKey: "idem-1",
  expectedRevision: null as number | null,
};

function req(
  command: StudioControlCommand,
  params: Record<string, unknown>,
  overrides: Partial<typeof BASE> = {},
): Record<string, unknown> {
  return {
    ...BASE,
    ...overrides,
    command,
    params,
  };
}

function expectInvalidRequest(value: unknown): void {
  expect(() => parseStudioControlRequest(value)).toThrowError(
    TypeError,
  );
  expect(() => parseStudioControlRequest(value)).toThrow(
    "Studio control request is invalid.",
  );
}

describe("studio control protocol constants", () => {
  it("exports version and byte limit", () => {
    expect(STUDIO_CONTROL_PROTOCOL_VERSION).toBe(1);
    expect(STUDIO_CONTROL_MAX_REQUEST_BYTES).toBe(1_048_576);
  });

  it("freezes command tuple in exact order", () => {
    expect([...STUDIO_CONTROL_COMMANDS]).toEqual([
      "capabilities.get",
      "project.get",
      "selection.get",
      "workspace.navigate",
      "asset.import",
      "video.import",
      "model.status",
      "model.setup",
      "jobs.list",
      "jobs.cancel",
      "export.run",
    ]);
    expect(Object.isFrozen(STUDIO_CONTROL_COMMANDS)).toBe(true);
  });
});

describe("parseStudioControlRequest — valid commands", () => {
  it("parses empty-param commands", () => {
    for (const command of [
      "capabilities.get",
      "project.get",
      "selection.get",
      "jobs.list",
    ] as const) {
      const parsed = parseStudioControlRequest(req(command, {}));
      expect(parsed.command).toBe(command);
      expect(parsed.params).toEqual({});
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.params)).toBe(true);
    }
  });

  it("parses workspace.navigate", () => {
    for (const workspaceId of ["slice", "compose", "collision", "export"] as const) {
      const parsed = parseStudioControlRequest(
        req("workspace.navigate", { workspaceId }),
      );
      expect(parsed).toMatchObject({
        command: "workspace.navigate",
        params: { workspaceId },
      });
    }
  });

  it("parses asset.import path without reading filesystem", () => {
    const parsed = parseStudioControlRequest(
      req("asset.import", { path: "C:\\sprites\\hero.png" }),
    );
    expect(parsed).toMatchObject({
      command: "asset.import",
      params: { path: "C:\\sprites\\hero.png" },
    });
  });

  it("parses video.import with mode all", () => {
    const parsed = parseStudioControlRequest(
      req("video.import", {
        path: "/clips/a.mp4",
        startUs: 0,
        endUs: 1_000_000,
        sampling: { mode: "all" },
      }),
    );
    expect(parsed.command).toBe("video.import");
    if (parsed.command === "video.import") {
      expect(parsed.params.startUs).toBe(0);
      expect(parsed.params.endUs).toBe(1_000_000);
      expect(parsed.params.sampling).toEqual({ mode: "all" });
      expect(Object.isFrozen(parsed.params.sampling)).toBe(true);
    }
  });

  it("parses video.import with fps sampling bounds", () => {
    for (const fps of [0.1, 30, 120]) {
      const parsed = parseStudioControlRequest(
        req("video.import", {
          path: "v.mp4",
          startUs: 10,
          endUs: 20,
          sampling: { mode: "fps", fps },
        }),
      );
      if (parsed.command === "video.import") {
        expect(parsed.params.sampling).toEqual({ mode: "fps", fps });
      }
    }
  });

  it("parses model.status and model.setup", () => {
    for (const modelId of ["birefnet-lite-512", "rmbg-2.0"] as const) {
      const status = parseStudioControlRequest(
        req("model.status", { modelId }),
      );
      expect(status).toMatchObject({
        command: "model.status",
        params: { modelId },
      });
      const setup = parseStudioControlRequest(
        req("model.setup", { modelId, acceptLicense: true }),
      );
      expect(setup).toMatchObject({
        command: "model.setup",
        params: { modelId, acceptLicense: true },
      });
    }
  });

  it("parses jobs.cancel and export.run", () => {
    expect(
      parseStudioControlRequest(req("jobs.cancel", { jobId: "job-42" })),
    ).toMatchObject({ command: "jobs.cancel", params: { jobId: "job-42" } });

    for (const format of ["png", "zip", "gif", "mp4", "webm"] as const) {
      expect(
        parseStudioControlRequest(req("export.run", { format })),
      ).toMatchObject({ command: "export.run", params: { format } });
    }
  });

  it("accepts nonnegative expectedRevision and null", () => {
    expect(
      parseStudioControlRequest(
        req("project.get", {}, { expectedRevision: null }),
      ).expectedRevision,
    ).toBeNull();
    expect(
      parseStudioControlRequest(
        req("project.get", {}, { expectedRevision: 0 }),
      ).expectedRevision,
    ).toBe(0);
    expect(
      parseStudioControlRequest(
        req("project.get", {}, { expectedRevision: 99 }),
      ).expectedRevision,
    ).toBe(99);
  });

  it("copies and freezes so caller mutation cannot affect result", () => {
    const params = { path: "a.png" };
    const input = req("asset.import", params);
    const parsed = parseStudioControlRequest(input);
    (input as { requestId: string }).requestId = "mutated";
    params.path = "mutated.png";
    expect(parsed.requestId).toBe("req-1");
    if (parsed.command === "asset.import") {
      expect(parsed.params.path).toBe("a.png");
    }
    expect(() => {
      (parsed as { requestId: string }).requestId = "x";
    }).toThrow();
    expect(() => {
      (parsed.params as { path?: string }).path = "x";
    }).toThrow();
  });
});

describe("parseStudioControlRequest — hostile / invalid input", () => {
  it("rejects non-plain objects", () => {
    expectInvalidRequest(null);
    expectInvalidRequest(undefined);
    expectInvalidRequest(42);
    expectInvalidRequest("string");
    expectInvalidRequest([]);
    expectInvalidRequest(Object.create(null));
    class C {
      version = 1;
    }
    expectInvalidRequest(new C());
    expectInvalidRequest(new Date());
    expectInvalidRequest(new Map());
  });

  it("never invokes getters", () => {
    let got = false;
    const hostile: Record<string, unknown> = {};
    for (const key of [
      "version",
      "requestId",
      "idempotencyKey",
      "command",
      "expectedRevision",
      "params",
    ]) {
      Object.defineProperty(hostile, key, {
        enumerable: true,
        configurable: true,
        get() {
          got = true;
          return key === "version"
            ? 1
            : key === "params"
              ? {}
              : key === "expectedRevision"
                ? null
                : key === "command"
                  ? "project.get"
                  : "x";
        },
      });
    }
    expectInvalidRequest(hostile);
    expect(got).toBe(false);
  });

  it("rejects symbol keys", () => {
    const input = req("project.get", {});
    Object.defineProperty(input, Symbol("secret"), {
      value: "leak",
      enumerable: true,
    });
    expectInvalidRequest(input);
  });

  it("rejects __proto__ pollution keys on request", () => {
    const polluted = JSON.parse(
      '{"version":1,"requestId":"r","idempotencyKey":"i","command":"project.get","expectedRevision":null,"params":{},"__proto__":{"polluted":true}}',
    );
    // JSON.parse may apply __proto__ specially; also test explicit own key.
    expectInvalidRequest(polluted);

    const withProtoKey: Record<string, unknown> = req("project.get", {});
    Object.defineProperty(withProtoKey, "__proto__", {
      value: { admin: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    // exact key set fails due to extra key
    expectInvalidRequest(withProtoKey);
  });

  it("rejects nested __proto__ in success result via create", () => {
    expect(() =>
      createStudioControlSuccess({
        version: 1,
        requestId: "r",
        ok: true,
        revision: 0,
        result: JSON.parse('{"__proto__":{"x":1}}'),
      }),
    ).toThrow("Studio control success response is invalid.");
  });

  it("rejects missing and extra request keys", () => {
    expectInvalidRequest({
      version: 1,
      requestId: "r",
      idempotencyKey: "i",
      command: "project.get",
      expectedRevision: null,
    });
    expectInvalidRequest({
      ...req("project.get", {}),
      extra: true,
    });
  });

  it("rejects arrays where object required", () => {
    expectInvalidRequest(req("project.get", [] as unknown as Record<string, unknown>));
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: 0,
        endUs: 1,
        sampling: [] as unknown as { mode: "all" },
      }),
    );
  });

  it("rejects unsupported commands and bad version", () => {
    expectInvalidRequest(req("project.delete" as StudioControlCommand, {}));
    expectInvalidRequest({
      ...req("project.get", {}),
      version: 2,
    });
    expectInvalidRequest({
      ...req("project.get", {}),
      version: "1",
    });
  });

  it("rejects bad id bounds", () => {
    expectInvalidRequest(req("project.get", {}, { requestId: "" }));
    expectInvalidRequest(
      req("project.get", {}, { requestId: "x".repeat(129) }),
    );
    expectInvalidRequest(req("project.get", {}, { idempotencyKey: "" }));
    expectInvalidRequest(
      req("project.get", {}, { idempotencyKey: "y".repeat(129) }),
    );
  });

  it("rejects stale/negative/non-integer expectedRevision", () => {
    expectInvalidRequest(
      req("project.get", {}, { expectedRevision: -1 }),
    );
    expectInvalidRequest(
      req("project.get", {}, { expectedRevision: 1.5 }),
    );
    expectInvalidRequest(
      req("project.get", {}, { expectedRevision: Number.NaN }),
    );
    expectInvalidRequest(
      req("project.get", {}, { expectedRevision: Number.POSITIVE_INFINITY }),
    );
    expectInvalidRequest(
      req("project.get", {}, {
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      }),
    );
  });

  it("rejects bad workspace, model, export enums", () => {
    expectInvalidRequest(
      req("workspace.navigate", { workspaceId: "grid" }),
    );
    expectInvalidRequest(req("model.status", { modelId: "other" }));
    expectInvalidRequest(
      req("model.setup", { modelId: "birefnet-lite-512", acceptLicense: "yes" }),
    );
    expectInvalidRequest(req("export.run", { format: "jpg" }));
  });

  it("rejects bad asset path and jobId bounds", () => {
    expectInvalidRequest(req("asset.import", { path: "" }));
    expectInvalidRequest(req("asset.import", { path: "p".repeat(4097) }));
    expectInvalidRequest(req("jobs.cancel", { jobId: "" }));
    expectInvalidRequest(req("jobs.cancel", { jobId: "j".repeat(129) }));
  });

  it("rejects bad video.import params including NaN/Infinity", () => {
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: -1,
        endUs: 10,
        sampling: { mode: "all" },
      }),
    );
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: 10,
        endUs: 10,
        sampling: { mode: "all" },
      }),
    );
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: 0,
        endUs: 1,
        sampling: { mode: "fps", fps: Number.NaN },
      }),
    );
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: 0,
        endUs: 1,
        sampling: { mode: "fps", fps: Number.POSITIVE_INFINITY },
      }),
    );
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: 0,
        endUs: 1,
        sampling: { mode: "fps", fps: 0.09 },
      }),
    );
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: 0,
        endUs: 1,
        sampling: { mode: "fps", fps: 120.1 },
      }),
    );
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: 0,
        endUs: 1,
        sampling: { mode: "fps" },
      }),
    );
    expectInvalidRequest(
      req("video.import", {
        path: "a",
        startUs: 0,
        endUs: 1,
        sampling: { mode: "all", fps: 30 },
      }),
    );
  });

  it("rejects extra keys on params", () => {
    expectInvalidRequest(req("project.get", { extra: 1 }));
    expectInvalidRequest(
      req("workspace.navigate", { workspaceId: "slice", x: 1 }),
    );
  });

  it("error messages stay generic and do not echo secrets", () => {
    const secret = "SUPER_SECRET_TOKEN_9f3a";
    try {
      parseStudioControlRequest(
        req("asset.import", { path: secret, evil: true }),
      );
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
      expect((e as Error).message).toBe("Studio control request is invalid.");
      expect((e as Error).message).not.toContain(secret);
      expect(String(e)).not.toContain(secret);
    }
  });
});

describe("parseStudioControlRequestJson", () => {
  it("parses valid JSON text", () => {
    const text = JSON.stringify(req("selection.get", {}));
    const parsed = parseStudioControlRequestJson(text);
    expect(parsed.command).toBe("selection.get");
  });

  it("rejects invalid JSON with generic error", () => {
    expect(() => parseStudioControlRequestJson("{")).toThrowError(TypeError);
    expect(() => parseStudioControlRequestJson("{")).toThrow(
      "Studio control request JSON is invalid.",
    );
  });

  it("enforces UTF-8 byte limit including multibyte characters", () => {
    // Each euro sign is 3 UTF-8 bytes. Build a payload over the limit.
    const overhead = JSON.stringify(
      req("asset.import", { path: "" }),
    ).length;
    // Use multibyte path content so byte length >> string length.
    const euro = "€"; // 3 bytes
    const maxBytes = STUDIO_CONTROL_MAX_REQUEST_BYTES;
    // Craft path so total UTF-8 bytes exceed max.
    const pathChars = Math.ceil((maxBytes - overhead + 50) / 3);
    const path = euro.repeat(pathChars);
    const text = JSON.stringify(req("asset.import", { path }));
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(bytes).toBeGreaterThan(maxBytes);
    // String length may still be under max if only counting UTF-16 units loosely;
    // protocol must use UTF-8 bytes.
    expect(() => parseStudioControlRequestJson(text)).toThrow(
      "Studio control request JSON is invalid.",
    );
  });

  it("parses JSON at the exact byte limit and rejects one byte over first", () => {
    const prefix = '{"padding":"';
    const suffix = '"}';
    const paddingLength =
      STUDIO_CONTROL_MAX_REQUEST_BYTES - prefix.length - suffix.length;
    const atLimit = `${prefix}${"x".repeat(paddingLength)}${suffix}`;
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(
      STUDIO_CONTROL_MAX_REQUEST_BYTES,
    );
    expect(() => parseStudioControlRequestJson(atLimit)).toThrow(
      "Studio control request is invalid.",
    );

    const overLimit = `${atLimit} `;
    expect(new TextEncoder().encode(overLimit).byteLength).toBe(
      STUDIO_CONTROL_MAX_REQUEST_BYTES + 1,
    );
    expect(() => parseStudioControlRequestJson(overLimit)).toThrow(
      "Studio control request JSON is invalid.",
    );
  });

  it("rejects non-string input", () => {
    expect(() =>
      parseStudioControlRequestJson(null as unknown as string),
    ).toThrow("Studio control request JSON is invalid.");
  });

  it("does not echo hostile JSON content in errors", () => {
    const secret = "PASSWORD=hunter2-leak";
    try {
      parseStudioControlRequestJson(`{"token":"${secret}"`);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe(
        "Studio control request JSON is invalid.",
      );
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it("does not echo errors thrown by proxy reflection traps", () => {
    const secret = "PROXY_SECRET_72d";
    const hostile = new Proxy(req("project.get", {}), {
      ownKeys() {
        throw new Error(secret);
      },
    });
    try {
      parseStudioControlRequest(hostile);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe(
        "Studio control request is invalid.",
      );
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("createStudioControlSuccess / Failure", () => {
  it("creates frozen success with JSON-safe result", () => {
    const success = createStudioControlSuccess({
      version: 1,
      requestId: "r1",
      ok: true,
      revision: 3,
      result: { a: [1, "x", true, null], b: 0 },
    });
    expect(success).toEqual({
      version: 1,
      requestId: "r1",
      ok: true,
      revision: 3,
      result: { a: [1, "x", true, null], b: 0 },
    });
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(success.result)).toBe(true);
  });

  it("creates frozen failure with exact error schema", () => {
    const failure = createStudioControlFailure({
      version: 1,
      requestId: "r2",
      ok: false,
      revision: 0,
      error: {
        code: "revision-conflict",
        message: "Revision mismatch.",
        retryable: false,
      },
    });
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.code).toBe("revision-conflict");
      expect(Object.isFrozen(failure.error)).toBe(true);
    }
  });

  it("rejects cycle in success result", () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.self = cycle;
    expect(() =>
      createStudioControlSuccess({
        version: 1,
        requestId: "r",
        ok: true,
        revision: 0,
        result: cycle,
      }),
    ).toThrow("Studio control success response is invalid.");
  });

  it("rejects depth 33 nested result", () => {
    let nested: unknown = null;
    for (let i = 0; i < 33; i++) {
      nested = { child: nested };
    }
    // depth: outermost is depth 1, 33 levels of objects => depth 33 at deepest
    expect(() =>
      createStudioControlSuccess({
        version: 1,
        requestId: "r",
        ok: true,
        revision: 0,
        result: nested,
      }),
    ).toThrow("Studio control success response is invalid.");
  });

  it("accepts depth 32 nested result", () => {
    let nested: unknown = "leaf";
    for (let i = 0; i < 31; i++) {
      nested = { child: nested };
    }
    // result depth 1 + 31 wrappers = 32 at leaf's parent...
    // copyJsonSafe(result, 1): root object depth 1, each child +1.
    // 31 nested objects from result: deepest object at depth 31, leaf string at 32.
    const ok = createStudioControlSuccess({
      version: 1,
      requestId: "r",
      ok: true,
      revision: 0,
      result: nested,
    });
    expect(ok.ok).toBe(true);
  });

  it("rejects sparse arrays in result", () => {
    const sparse: unknown[] = [];
    sparse[0] = 1;
    sparse[2] = 3; // hole at index 1
    expect(() =>
      createStudioControlSuccess({
        version: 1,
        requestId: "r",
        ok: true,
        revision: 0,
        result: sparse,
      }),
    ).toThrow("Studio control success response is invalid.");
  });

  it("rejects NaN, Infinity, undefined, bigint, function, symbol in result", () => {
    for (const result of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
      1n,
      () => 1,
      Symbol("x"),
    ]) {
      expect(() =>
        createStudioControlSuccess({
          version: 1,
          requestId: "r",
          ok: true,
          revision: 0,
          result,
        }),
      ).toThrow("Studio control success response is invalid.");
    }
  });

  it("rejects getters on success input without invoking them", () => {
    let got = false;
    const input: Record<string, unknown> = {};
    for (const key of ["version", "requestId", "ok", "revision", "result"]) {
      Object.defineProperty(input, key, {
        enumerable: true,
        get() {
          got = true;
          return key === "ok" ? true : key === "version" ? 1 : key === "revision" ? 0 : key === "result" ? null : "r";
        },
      });
    }
    expect(() => createStudioControlSuccess(input)).toThrow(
      "Studio control success response is invalid.",
    );
    expect(got).toBe(false);
  });

  it("rejects negative revision and bad failure shapes", () => {
    expect(() =>
      createStudioControlSuccess({
        version: 1,
        requestId: "r",
        ok: true,
        revision: -1,
        result: null,
      }),
    ).toThrow();
    expect(() =>
      createStudioControlFailure({
        version: 1,
        requestId: "r",
        ok: false,
        revision: 0,
        error: {
          code: "nope",
          message: "x",
          retryable: false,
        },
      }),
    ).toThrow("Studio control failure response is invalid.");
    expect(() =>
      createStudioControlFailure({
        version: 1,
        requestId: "r",
        ok: false,
        revision: 0,
        error: {
          code: "internal",
          message: "",
          retryable: false,
        },
      }),
    ).toThrow();
    expect(() =>
      createStudioControlFailure({
        version: 1,
        requestId: "r",
        ok: false,
        revision: 0,
        error: {
          code: "internal",
          message: "m".repeat(513),
          retryable: false,
        },
      }),
    ).toThrow();
    expect(() =>
      createStudioControlFailure({
        version: 1,
        requestId: "r",
        ok: false,
        revision: 0,
        error: {
          code: "internal",
          message: "boom",
          retryable: false,
          stack: "secret-stack",
          path: "/secret",
          token: "tok",
        },
      }),
    ).toThrow("Studio control failure response is invalid.");
  });

  it("accepts all error codes", () => {
    for (const code of [
      "invalid-request",
      "unsupported-command",
      "revision-conflict",
      "duplicate-request",
      "not-found",
      "busy",
      "cancelled",
      "timeout",
      "internal",
    ] as const) {
      const f = createStudioControlFailure({
        version: 1,
        requestId: "r",
        ok: false,
        revision: 1,
        error: { code, message: "m", retryable: code === "busy" },
      });
      expect(f.error.code).toBe(code);
    }
  });

  it("success result is a deep copy immune to caller mutation", () => {
    const result = { items: [1, 2] };
    const success = createStudioControlSuccess({
      version: 1,
      requestId: "r",
      ok: true,
      revision: 0,
      result,
    });
    result.items.push(3);
    expect(success.result).toEqual({ items: [1, 2] });
  });

  it("copies array descriptor values without invoking a proxy get trap", () => {
    let readIndex = false;
    const result = new Proxy([1], {
      get(target, key, receiver) {
        if (key === "0") {
          readIndex = true;
          throw new Error("must not read through proxy");
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const success = createStudioControlSuccess({
      version: 1,
      requestId: "r",
      ok: true,
      revision: 0,
      result,
    });
    expect(success.result).toEqual([1]);
    expect(readIndex).toBe(false);
  });
});

describe("serializeStudioControlResponse", () => {
  it("serializes success as one JSON line without newline", () => {
    const line = serializeStudioControlResponse({
      version: 1,
      requestId: "r",
      ok: true,
      revision: 2,
      result: { ready: true },
    });
    expect(line.includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual({
      version: 1,
      requestId: "r",
      ok: true,
      revision: 2,
      result: { ready: true },
    });
  });

  it("serializes failure without stack/path/token fields", () => {
    const line = serializeStudioControlResponse({
      version: 1,
      requestId: "r",
      ok: false,
      revision: 0,
      error: {
        code: "not-found",
        message: "Missing.",
        retryable: false,
      },
    });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toEqual({
      version: 1,
      requestId: "r",
      ok: false,
      revision: 0,
      error: {
        code: "not-found",
        message: "Missing.",
        retryable: false,
      },
    });
    expect(line).not.toContain("stack");
    expect(line).not.toContain("token");
  });

  it("never serializes secrets from invalid objects", () => {
    const secret = "AWS_SECRET_abc123";
    expect(() =>
      serializeStudioControlResponse({
        version: 1,
        requestId: "r",
        ok: true,
        revision: 0,
        result: { token: secret },
        password: secret,
      }),
    ).toThrow("Studio control response is invalid.");

    try {
      serializeStudioControlResponse({
        version: 1,
        requestId: "r",
        ok: false,
        revision: 0,
        error: {
          code: "internal",
          message: "x",
          retryable: false,
          token: secret,
        },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
      expect(String(e)).not.toContain(secret);
    }
  });

  it("rejects getter-based hostile response without invoking getter", () => {
    let got = false;
    const hostile: Record<string, unknown> = {
      version: 1,
      requestId: "r",
      ok: true,
      revision: 0,
      result: null,
    };
    Object.defineProperty(hostile, "secret", {
      enumerable: true,
      get() {
        got = true;
        return "LEAK";
      },
    });
    expect(() => serializeStudioControlResponse(hostile)).toThrow();
    expect(got).toBe(false);
  });
});

describe("end-to-end typed request shapes", () => {
  it("round-trips every command through JSON parser", () => {
    const samples: StudioControlRequest[] = [
      parseStudioControlRequest(req("capabilities.get", {})),
      parseStudioControlRequest(req("project.get", {})),
      parseStudioControlRequest(req("selection.get", {})),
      parseStudioControlRequest(
        req("workspace.navigate", { workspaceId: "compose" }),
      ),
      parseStudioControlRequest(req("asset.import", { path: "a.png" })),
      parseStudioControlRequest(
        req("video.import", {
          path: "v.mp4",
          startUs: 0,
          endUs: 100,
          sampling: { mode: "fps", fps: 24 },
        }),
      ),
      parseStudioControlRequest(
        req("model.status", { modelId: "rmbg-2.0" }),
      ),
      parseStudioControlRequest(
        req("model.setup", {
          modelId: "birefnet-lite-512",
          acceptLicense: false,
        }),
      ),
      parseStudioControlRequest(req("jobs.list", {})),
      parseStudioControlRequest(req("jobs.cancel", { jobId: "j1" })),
      parseStudioControlRequest(req("export.run", { format: "webm" })),
    ];
    for (const sample of samples) {
      const again = parseStudioControlRequestJson(JSON.stringify(sample));
      expect(again).toEqual(sample);
    }
  });
});
