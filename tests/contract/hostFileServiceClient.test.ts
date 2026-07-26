import { describe, expect, it, vi } from "vitest";
import {
  createHostFileServiceClient,
  HostFileServiceError,
} from "../../core/control/hostFileServiceClient";

const TOKEN = "host-file-client-token-0123456789-abcdefghijklmnopqrstuvwxyz";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
const WEBM = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
]);
const QUICKTIME = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
]);
const MATROSKA = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
const AVI = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
]);
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
const FLV = new Uint8Array([0x46, 0x4c, 0x56]);
const MPEG = new Uint8Array([0x00, 0x00, 0x01, 0xba]);
const MPEG_TS = Object.assign(new Uint8Array(377), { 0: 0x47, 188: 0x47, 376: 0x47 });

function client(fetchImpl: typeof fetch) {
  return createHostFileServiceClient({
    baseUrl: "http://127.0.0.1:43119",
    token: TOKEN,
    fetch: fetchImpl,
  });
}

describe("host file service client", () => {
  it("returns detached image bytes with a verified MIME signature", async () => {
    const fetchImpl = vi.fn(async () => new Response(PNG, {
      headers: {
        "X-SpriteBoy-File-Size": String(PNG.byteLength),
        "X-SpriteBoy-File-Name": "hero.png",
        "X-SpriteBoy-Mime-Type": "image/png",
      },
    })) as unknown as typeof fetch;

    const result = await client(fetchImpl).read("D:\\media\\hero.png", "image");

    expect(result).toMatchObject({ name: "hero.png", byteSize: PNG.byteLength });
    expect(result.blob.type).toBe("image/png");
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(PNG);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:43119/v1/files/read",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ version: 1, path: "D:\\media\\hero.png", kind: "image" }),
        cache: "no-store",
        credentials: "omit",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it.each([
    ["JPEG", JPEG, "image", "image/jpeg"],
    ["WebP", WEBP, "image", "image/webp"],
    ["MP4", MP4, "video", "video/mp4"],
    ["WebM", WEBM, "video", "video/webm"],
    ["QuickTime", QUICKTIME, "video", "video/quicktime"],
    ["Matroska", MATROSKA, "video", "video/x-matroska"],
    ["AVI", AVI, "video", "video/x-msvideo"],
    ["Ogg", OGG, "video", "video/ogg"],
    ["FLV", FLV, "video", "video/x-flv"],
    ["MPEG", MPEG, "video", "video/mpeg"],
    ["MPEG transport stream", MPEG_TS, "video", "video/mp2t"],
  ] as const)("accepts verified %s magic and declared MIME", async (_label, bytes, kind, mimeType) => {
    const fetchImpl = vi.fn(async () => new Response(bytes, {
      headers: {
        "X-SpriteBoy-File-Size": String(bytes.byteLength),
        "X-SpriteBoy-File-Name": "clip%20one.bin",
        "X-SpriteBoy-Mime-Type": mimeType,
      },
    })) as unknown as typeof fetch;

    const result = await client(fetchImpl).read("D:\\media\\clip.bin", kind);

    expect(result).toMatchObject({ name: "clip one.bin", byteSize: bytes.byteLength });
    expect(result.blob.type).toBe(mimeType);
  });

  it("rejects invalid image bytes and response length drift", async () => {
    const invalidImage = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "X-SpriteBoy-File-Size": "3",
        "X-SpriteBoy-File-Name": "fake.png",
        "X-SpriteBoy-Mime-Type": "image/png",
      },
    })) as unknown as typeof fetch;
    const wrongLength = vi.fn(async () => new Response(PNG, {
      headers: {
        "X-SpriteBoy-File-Size": "9",
        "X-SpriteBoy-File-Name": "hero.png",
        "X-SpriteBoy-Mime-Type": "image/png",
      },
    })) as unknown as typeof fetch;

    await expect(client(invalidImage).read("D:\\fake.png", "image")).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(client(wrongLength).read("D:\\hero.png", "image")).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(client(invalidImage).read("D:\\fake.mp4", "video")).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("rejects MIME drift, unsafe names and unreadable response bodies", async () => {
    const mimeDrift = vi.fn(async () => new Response(PNG, {
      headers: {
        "X-SpriteBoy-File-Size": String(PNG.byteLength),
        "X-SpriteBoy-File-Name": "hero.png",
        "X-SpriteBoy-Mime-Type": "image/jpeg",
      },
    })) as unknown as typeof fetch;
    const unsafeName = vi.fn(async () => new Response(PNG, {
      headers: {
        "X-SpriteBoy-File-Size": String(PNG.byteLength),
        "X-SpriteBoy-File-Name": "..%2Fhero.png",
        "X-SpriteBoy-Mime-Type": "image/png",
      },
    })) as unknown as typeof fetch;
    const unreadableResponse = new Response(PNG, {
      headers: {
        "X-SpriteBoy-File-Size": String(PNG.byteLength),
        "X-SpriteBoy-File-Name": "hero.png",
        "X-SpriteBoy-Mime-Type": "image/png",
      },
    });
    vi.spyOn(unreadableResponse, "arrayBuffer").mockRejectedValue(new TypeError("stream failed"));
    const unreadable = vi.fn(async () => unreadableResponse) as unknown as typeof fetch;

    await expect(client(mimeDrift).read("D:\\hero.png", "image")).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(client(unsafeName).read("D:\\hero.png", "image")).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(client(unreadable).read("D:\\hero.png", "image")).rejects.toMatchObject({
      code: "read-failed",
    });
  });

  it("keeps typed broker failures and maps an aborted fetch", async () => {
    const denied = vi.fn(async () => new Response(JSON.stringify({
      version: 1,
      error: { code: "outside-root", message: "Host file is outside the allowed roots." },
    }), { status: 403, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as unknown as typeof fetch;

    await expect(client(denied).read("D:\\private.png", "image")).rejects.toMatchObject({
      code: "outside-root",
    });
    await expect(client(aborted).read("D:\\hero.png", "image", controller.signal)).rejects.toEqual(
      new HostFileServiceError("cancelled", "Host file read was cancelled."),
    );
  });

  it("separates authentication, malformed HTTP failures and network errors", async () => {
    const unauthorized = vi.fn(async () => new Response("not json", { status: 401 })) as unknown as typeof fetch;
    const unknownFailure = vi.fn(async () => new Response(JSON.stringify({
      version: 1,
      error: { code: "internal-stack", message: "private detail" },
    }), { status: 500 })) as unknown as typeof fetch;
    const unreadableFailure = vi.fn(async () => new Response("not-json", { status: 500 })) as unknown as typeof fetch;
    const network = vi.fn(async () => {
      throw new TypeError("connect ECONNREFUSED 127.0.0.1");
    }) as unknown as typeof fetch;

    await expect(client(unauthorized).read("D:\\hero.png", "image")).rejects.toEqual(
      new HostFileServiceError("authentication", "Host file service rejected the session token."),
    );
    await expect(client(unknownFailure).read("D:\\hero.png", "image")).rejects.toEqual(
      new HostFileServiceError("invalid-response", "Host file service rejected the request."),
    );
    await expect(client(unreadableFailure).read("D:\\hero.png", "image")).rejects.toEqual(
      new HostFileServiceError("invalid-response", "Host file service rejected the request."),
    );
    await expect(client(network).read("D:\\hero.png", "image")).rejects.toEqual(
      new HostFileServiceError("connection", "Host file service could not be reached."),
    );
  });

  it("forwards the caller abort signal and rejects invalid local inputs before fetch", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => new Response(PNG, {
      headers: {
        "X-SpriteBoy-File-Size": String(PNG.byteLength),
        "X-SpriteBoy-File-Name": "hero.png",
        "X-SpriteBoy-Mime-Type": "image/png",
      },
    })) as unknown as typeof fetch;
    const service = client(fetchImpl);

    await service.read("D:\\hero.png", "image", controller.signal);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:43119/v1/files/read",
      expect.objectContaining({ signal: controller.signal }),
    );
    await expect(service.read("", "image")).rejects.toThrow("path is invalid");
    await expect(service.read("D:\\hero.png", "audio" as "image")).rejects.toThrow("kind is invalid");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing name", null, "8", "image/png"],
    ["bad name encoding", "%E0%A4%A", "8", "image/png"],
    ["path-like name", "folder%5Chero.png", "8", "image/png"],
    ["long name", "a".repeat(256), "8", "image/png"],
    ["missing size", "hero.png", null, "image/png"],
    ["fractional size", "hero.png", "8.5", "image/png"],
    ["missing MIME", "hero.png", "8", null],
  ] as const)("rejects a %s response header", async (_label, name, size, mimeType) => {
    const headers = new Headers();
    if (name !== null) headers.set("X-SpriteBoy-File-Name", name);
    if (size !== null) headers.set("X-SpriteBoy-File-Size", size);
    if (mimeType !== null) headers.set("X-SpriteBoy-Mime-Type", mimeType);
    const fetchImpl = vi.fn(async () => new Response(PNG, { headers })) as unknown as typeof fetch;

    await expect(client(fetchImpl).read("D:\\media\\hero.png", "image")).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("rejects unsafe client configuration before any request", () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const baseUrl of [
      "invalid",
      "https://127.0.0.1:43119",
      "http://192.168.1.2:43119",
      "http://user@localhost:43119",
      "http://localhost:43119/path",
      "http://localhost:43119/?query=1",
      "http://localhost:43119/#hash",
    ]) {
      expect(() => createHostFileServiceClient({ baseUrl, token: TOKEN, fetch: fetchImpl }))
        .toThrow("URL is invalid");
    }
    expect(() => createHostFileServiceClient({
      baseUrl: "http://localhost:43119",
      token: "short",
      fetch: fetchImpl,
    })).toThrow("token is invalid");
    expect(() => createHostFileServiceClient({
      baseUrl: "http://localhost:43119",
      token: "x".repeat(513),
      fetch: fetchImpl,
    })).toThrow("token is invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
