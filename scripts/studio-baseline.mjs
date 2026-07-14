/**
 * Produce a deterministic, source-only inventory for the current working tree.
 *
 * The command intentionally has no output side effects: it only writes the
 * JSON report to stdout. It can be invoked with either Bun or Node:
 *
 *   bun scripts/studio-baseline.mjs [--root <path>] [--pretty]
 *
 * The exported helpers keep the inventory contract directly testable without
 * running the CLI as a module import.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_VERSION = 1;
export const SYMLINK_POLICY = "exclude";

/**
 * Only source/document formats useful to the baseline are included. The dot
 * is part of each key so the value can be used as a normalized extension.
 */
export const INCLUDED_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".md",
  ".json",
  ".yml",
  ".yaml",
]);

/**
 * Directory names excluded at every depth. This is kept in the report so the
 * scope of a baseline can be audited without recording the absolute root.
 */
export const EXCLUDED_DIRECTORIES = Object.freeze([
  ".git",
  ".idea",
  ".local",
  ".scratch",
  ".vscode",
  ".vite",
  ".vite-temp",
  ".vs",
  "__generated__",
  "artifacts",
  "coverage",
  "dist",
  "dist-ssr",
  "generated",
  "locale",
  "locales",
  "logs",
  "node_modules",
]);

const excludedDirectorySet = new Set(EXCLUDED_DIRECTORIES.map((name) => name.toLowerCase()));

function comparePath(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Convert a path to a stable, root-relative POSIX path. */
export function normalizeRelativePath(root, filePath) {
  const rootPath = resolve(root);
  const absolutePath = resolve(filePath);
  const relativePath = relative(rootPath, absolutePath);

  // A path outside the root is an implementation error rather than something
  // that should leak an absolute path into the report.
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`File is outside inventory root: ${filePath}`);
  }

  return relativePath.split(sep).join("/");
}

/** Return the normalized extension for a file, or null when it is unsupported. */
export function getIncludedExtension(filePath) {
  const extension = extname(filePath).toLowerCase();
  return INCLUDED_EXTENSIONS.includes(extension) ? extension : null;
}

/**
 * Count physical text lines. A non-empty file has one line per separator plus
 * one final line when it does not end in a separator. CRLF is one separator.
 */
export function countLines(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  if (text.length === 0) return 0;

  let separators = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\r") {
      separators += 1;
      if (text[index + 1] === "\n") index += 1;
    } else if (character === "\n") {
      separators += 1;
    }
  }

  const endsWithSeparator = text.endsWith("\n") || text.endsWith("\r");
  return separators + (endsWithSeparator ? 0 : 1);
}

/** Return the top-level surface for a normalized manifest path. */
export function getTopLevelSurface(relativePath) {
  const firstSlash = relativePath.indexOf("/");
  return firstSlash === -1 ? "root" : relativePath.slice(0, firstSlash);
}

function isExcludedDirectory(name) {
  return excludedDirectorySet.has(name.toLowerCase());
}

function isExcludedEnvironmentFile(name) {
  const lowerName = name.toLowerCase();
  return lowerName === ".env" || lowerName.startsWith(".env.") || lowerName.endsWith(".env") || lowerName.endsWith(".code-workspace");
}

function createAggregate() {
  return { files: 0, bytes: 0, lines: 0 };
}

function addToAggregate(aggregate, file) {
  aggregate.files += 1;
  aggregate.bytes += file.bytes;
  aggregate.lines += file.lines;
}

function collectFilePaths(rootPath) {
  const files = [];

  function visit(directoryPath) {
    const entries = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) => comparePath(left.name, right.name));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!isExcludedDirectory(entry.name)) visit(resolve(directoryPath, entry.name));
        continue;
      }

      // Keep the inventory closed over the physical working tree. Following a
      // symlink could read content outside the selected root or double-count a
      // source file through an alias.
      if (!entry.isFile()) continue;
      if (isExcludedEnvironmentFile(entry.name)) continue;
      if (getIncludedExtension(entry.name) === null) continue;

      files.push(resolve(directoryPath, entry.name));
    }
  }

  visit(rootPath);
  return files;
}

/** Build the deterministic inventory for a directory. */
export function createInventory(root = process.cwd()) {
  const rootPath = resolve(root);
  const rootStats = statSync(rootPath);
  if (!rootStats.isDirectory()) throw new Error(`Inventory root is not a directory: ${root}`);

  const manifest = collectFilePaths(rootPath)
    .map((filePath) => {
      const path = normalizeRelativePath(rootPath, filePath);
      const extension = getIncludedExtension(path);
      // collectFilePaths already filters unsupported extensions.
      if (extension === null) throw new Error(`Unsupported file extension: ${path}`);

      const bytes = readFileSync(filePath);
      return {
        path,
        extension,
        surface: getTopLevelSurface(path),
        bytes: bytes.byteLength,
        lines: countLines(bytes),
      };
    })
    .sort((left, right) => comparePath(left.path, right.path));

  const totals = createAggregate();
  const extensions = new Map();
  const surfaces = new Map();

  for (const file of manifest) {
    addToAggregate(totals, file);

    if (!extensions.has(file.extension)) extensions.set(file.extension, createAggregate());
    addToAggregate(extensions.get(file.extension), file);

    if (!surfaces.has(file.surface)) surfaces.set(file.surface, createAggregate());
    addToAggregate(surfaces.get(file.surface), file);
  }

  const sortAggregateMap = (map) => Object.fromEntries(
    [...map.entries()]
      .sort(([left], [right]) => comparePath(left, right))
      .map(([key, aggregate]) => [key, aggregate]),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    symlinkPolicy: SYMLINK_POLICY,
    totals,
    extensions: sortAggregateMap(extensions),
    surfaces: sortAggregateMap(surfaces),
    excludedDirectories: [...EXCLUDED_DIRECTORIES],
    manifest,
  };
}

/** Parse CLI arguments without touching the filesystem. */
export function parseArguments(args = []) {
  let root;
  let pretty = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--pretty") {
      if (pretty) throw new Error("Duplicate argument: --pretty");
      pretty = true;
      continue;
    }

    if (argument === "--root") {
      if (root !== undefined) throw new Error("Duplicate argument: --root");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--root requires a path");
      root = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--root=")) {
      if (root !== undefined) throw new Error("Duplicate argument: --root");
      const value = argument.slice("--root=".length);
      if (!value) throw new Error("--root requires a path");
      root = value;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { root: root ?? process.cwd(), pretty };
}

/** Run the CLI and return its process exit code. */
export function runCli(args = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  try {
    const options = parseArguments(args);
    const inventory = createInventory(options.root);
    stdout.write(`${JSON.stringify(inventory, null, options.pretty ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`studio-baseline: ${message}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = runCli();
