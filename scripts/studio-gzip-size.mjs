/** Deterministic Node gzip level-9 measurement for validated initial JS assets. */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const GZIP_MEASUREMENT_SCHEMA_VERSION = 1;

export function validateGzipAssetPaths(paths) {
  if (
    !Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length ||
    paths.some((path) => typeof path !== "string" || !/^dist\/assets\/[A-Za-z0-9._-]+\.js$/u.test(path))
  ) {
    throw new TypeError("Gzip asset paths are invalid.");
  }
  return Object.freeze([...paths].sort());
}

export function measureGzipAssets(paths, options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const read = options.readFileSync ?? readFileSync;
  const statFile = options.lstatSync ?? lstatSync;
  const realpath = options.realpathSync ?? realpathSync;
  const gzip = options.gzipSync ?? gzipSync;
  let initialJsBytes = 0;
  let initialJsGzipBytes = 0;
  for (const path of validateGzipAssetPaths(paths)) {
    const absolutePath = resolve(cwd, path);
    const stat = statFile(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError("Gzip asset must be a physical file.");
    if (resolve(realpath(absolutePath)) !== absolutePath) {
      throw new TypeError("Gzip asset path must not traverse a linked parent.");
    }
    const bytes = read(absolutePath);
    if (!Buffer.isBuffer(bytes) || bytes.byteLength !== stat.size) {
      throw new TypeError("Gzip asset bytes are invalid.");
    }
    initialJsBytes += bytes.byteLength;
    initialJsGzipBytes += gzip(bytes, { level: 9 }).byteLength;
  }
  return Object.freeze({
    schemaVersion: GZIP_MEASUREMENT_SCHEMA_VERSION,
    initialChunkCount: paths.length,
    initialJsBytes,
    initialJsGzipBytes,
  });
}

export function runGzipMeasurementCli(args = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    stdout.write(`${JSON.stringify(measureGzipAssets(args))}\n`);
    return 0;
  } catch {
    stderr.write(`${JSON.stringify({
      schemaVersion: GZIP_MEASUREMENT_SCHEMA_VERSION,
      status: "fail",
      reason: "gzip-measurement-failed",
    })}\n`);
    return 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedScript === import.meta.url) process.exitCode = runGzipMeasurementCli();
