import { describe, expect, it, vi } from "vitest";
import {
  createLocalModelServiceClient,
  LocalModelServiceError,
} from "../../core/models/localModelServiceClient";

const TOKEN = "model-client-token-0123456789-abcdefghijklmnopqrstuvwxyz";

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
        method: "GET",
        credentials: "omit",
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
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
});
