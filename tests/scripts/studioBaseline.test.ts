import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  countLines,
  createInventory,
  parseArguments,
  runCli,
  SYMLINK_POLICY,
} from "../../scripts/studio-baseline.mjs";

const temporaryRoots: string[] = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "studio-baseline-"));
  temporaryRoots.push(root);
  return root;
}

function writeFixture(root: string, relativePath: string, content: string | Uint8Array) {
  const filePath = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("studio baseline inventory", () => {
  it("reports a stable normalized manifest and excludes generated/local/IDE paths", () => {
    const root = makeRoot();
    writeFixture(root, "README.md", "");
    writeFixture(root, "scripts/tool.mjs", "export const tool = true;\n");
    writeFixture(root, "src/z.TSX", "z\r\ny\r\n");
    writeFixture(root, "src/a.ts", "a\nb");

    for (const directory of [
      ".git",
      "node_modules",
      "dist",
      "dist-ssr",
      "coverage",
      "logs",
      ".vite",
      ".vite-temp",
      ".scratch",
      "artifacts",
      ".local",
      ".vscode",
      ".idea",
      "generated",
      "locales",
    ]) {
      writeFixture(root, `${directory}/ignored.ts`, "must not be inventoried");
    }
    writeFixture(root, ".env.ts", "must not be inventoried");

    const inventory = createInventory(root);

    expect(inventory.schemaVersion).toBe(1);
    expect(SYMLINK_POLICY).toBe("exclude");
    expect(inventory.symlinkPolicy).toBe("exclude");
    expect(inventory.manifest.map((file) => file.path)).toEqual([
      "README.md",
      "scripts/tool.mjs",
      "src/a.ts",
      "src/z.TSX",
    ]);
    expect(inventory.manifest.every((file) => !file.path.includes("\\"))).toBe(true);
    expect(JSON.stringify(inventory)).not.toContain(root);
    expect(inventory.excludedDirectories).toContain("node_modules");
    expect(inventory.surfaces).toEqual({
      root: { files: 1, bytes: 0, lines: 0 },
      scripts: { files: 1, bytes: Buffer.byteLength("export const tool = true;\n"), lines: 1 },
      src: { files: 2, bytes: Buffer.byteLength("z\r\ny\r\n") + Buffer.byteLength("a\nb"), lines: 4 },
    });
  });

  it("counts empty, LF, CRLF, and unterminated files consistently", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("one")).toBe(1);
    expect(countLines("one\n two\n")).toBe(2);
    expect(countLines("one\r\ntwo\r\n")).toBe(2);
    expect(countLines("one\rtwo")).toBe(2);

    const root = makeRoot();
    writeFixture(root, "empty.ts", "");
    writeFixture(root, "lf.ts", "one\ntwo\n");
    writeFixture(root, "crlf.ts", "one\r\ntwo\r\n");
    writeFixture(root, "plain.ts", "one");

    const inventory = createInventory(root);
    expect(inventory.totals).toEqual({
      files: 4,
      bytes: Buffer.byteLength("one\ntwo\n") + Buffer.byteLength("one\r\ntwo\r\n") + Buffer.byteLength("one"),
      lines: 5,
    });
    expect(inventory.extensions[".ts"]).toEqual(inventory.totals);
  });

  it("sorts aggregates and remains byte-for-byte deterministic", () => {
    const root = makeRoot();
    writeFixture(root, "zeta/data.yaml", "a\n");
    writeFixture(root, "alpha/data.json", "{}\n");
    writeFixture(root, "alpha/style.css", "a{}\n");

    const first = createInventory(root);
    const second = createInventory(root);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.keys(first.extensions)).toEqual([".css", ".json", ".yaml"]);
    expect(Object.keys(first.surfaces)).toEqual(["alpha", "zeta"]);
    expect(first.manifest.map((file) => file.path)).toEqual([
      "alpha/data.json",
      "alpha/style.css",
      "zeta/data.yaml",
    ]);
  });
});

describe("studio baseline CLI", () => {
  it("parses root and pretty options without running on import", () => {
    expect(parseArguments(["--root", "fixtures", "--pretty"])).toEqual({
      root: "fixtures",
      pretty: true,
    });
  });

  it("writes only JSON to stdout and rejects invalid arguments", () => {
    const root = makeRoot();
    writeFixture(root, "index.ts", "export default 1;\n");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const output = { stdout: { write: (value: string) => stdout.push(value) }, stderr: { write: (value: string) => stderr.push(value) } };

    expect(runCli(["--root", root, "--pretty"], output)).toBe(0);
    const report = JSON.parse(stdout.join(""));
    expect(report.schemaVersion).toBe(1);
    expect(stdout.join("")).toContain("\n  \"schemaVersion\"");
    expect(stderr).toEqual([]);

    expect(runCli(["--unknown"], output)).toBe(1);
    expect(stderr.join("")).toContain("Unknown argument");
  });

  it("fails when --root has no value or points to a file", () => {
    const root = makeRoot();
    const filePath = join(root, "file.ts");
    writeFileSync(filePath, "x");
    const stderr: string[] = [];
    const output = { stdout: { write: () => undefined }, stderr: { write: (value: string) => stderr.push(value) } };

    expect(runCli(["--root"], output)).toBe(1);
    expect(runCli(["--root", filePath], output)).toBe(1);
    expect(stderr.join("")).toContain("Inventory root is not a directory");
  });
});

// Keep the imported node fs helper exercised by the same deterministic fixture
// setup used by the CLI test (and make accidental path-root regressions visible).
it("uses the fixture bytes written to disk", () => {
  const root = makeRoot();
  writeFixture(root, "bytes.ts", "é\n");
  expect(readFileSync(join(root, "bytes.ts")).byteLength).toBeGreaterThan(2);
  expect(createInventory(root).manifest[0].bytes).toBe(readFileSync(join(root, "bytes.ts")).byteLength);
});
