import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHostFileBroker,
  HostFileBrokerError,
} from "../../scripts/hostFileBroker";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "spriteboy-host-files-"));
  cleanup.push(parent);
  const root = join(parent, "allowed");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  const imagePath = join(root, "sprite.png");
  const outsidePath = join(outside, "private.png");
  await writeFile(imagePath, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await writeFile(outsidePath, new Uint8Array([1, 2, 3, 4]));
  return { root, outside, imagePath, outsidePath };
}

describe("host file broker", () => {
  it("reads a regular file inside an allowed canonical root", async () => {
    const value = await fixture();
    const broker = await createHostFileBroker({ roots: [value.root] });

    const file = await broker.read(value.imagePath, "image");
    expect(file).toMatchObject({
      name: "sprite.png",
      byteSize: 8,
      mimeType: "image/png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    file.release();
  });

  it("rejects relative paths, directories, outside files, and oversize files", async () => {
    const value = await fixture();
    const broker = await createHostFileBroker({
      roots: [value.root],
      imageMaxBytes: 7,
    });

    await expect(broker.read("sprite.png", "image")).rejects.toMatchObject({ code: "invalid-request" });
    await expect(broker.read(value.root, "image")).rejects.toMatchObject({ code: "not-file" });
    await expect(broker.read(value.outsidePath, "image")).rejects.toMatchObject({ code: "outside-root" });
    await expect(broker.read(value.imagePath, "image")).rejects.toMatchObject({ code: "too-large" });
  });

  it("resolves parent junctions and rejects escapes", async () => {
    const value = await fixture();
    const junction = join(value.root, "escaped");
    await symlink(value.outside, junction, "junction");
    const broker = await createHostFileBroker({ roots: [value.root] });

    await expect(broker.read(join(junction, "private.png"), "image")).rejects.toMatchObject({
      code: "outside-root",
    });
  });

  it("honors cancellation before opening a file", async () => {
    const value = await fixture();
    const broker = await createHostFileBroker({ roots: [value.root] });
    const controller = new AbortController();
    controller.abort();

    await expect(broker.read(value.imagePath, "image", controller.signal)).rejects.toBeInstanceOf(
      HostFileBrokerError,
    );
    await expect(broker.read(value.imagePath, "image", controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("does not serve arbitrary bytes disguised as media", async () => {
    const value = await fixture();
    const secretPath = join(value.root, ".env");
    await writeFile(secretPath, "SECRET=do-not-serve");
    const broker = await createHostFileBroker({ roots: [value.root] });

    await expect(broker.read(secretPath, "video")).rejects.toMatchObject({
      code: "unsupported-type",
    });
  });

  it("allows only one in-memory host file read at a time", async () => {
    const value = await fixture();
    const broker = await createHostFileBroker({ roots: [value.root] });

    const first = await broker.read(value.imagePath, "image");
    await expect(broker.read(value.imagePath, "image")).rejects.toMatchObject({ code: "busy" });
    expect(first).toMatchObject({ mimeType: "image/png" });
    first.release();
    first.release();
    const next = await broker.read(value.imagePath, "image");
    expect(next).toMatchObject({ mimeType: "image/png" });
    next.release();
  });
});
