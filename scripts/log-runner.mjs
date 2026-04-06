/**
 * Log runner – Executes a command and pipes stdout+stderr to logs/<name>.log
 * Usage: node scripts/log-runner.mjs <name> "<command>"
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , name, command] = process.argv;

if (!name || !command) {
  console.error('Usage: node scripts/log-runner.mjs <name> "<command>"');
  process.exit(1);
}

mkdirSync("logs", { recursive: true });

const logPath = join("logs", `${name}.log`);
const header = `[${new Date().toISOString()}] Running: ${command}\n${"─".repeat(60)}\n`;

try {
  const output = execSync(command, { encoding: "utf-8", stdio: "pipe" });
  writeFileSync(logPath, header + output);
  console.log(`✅ ${name} completed – log saved to ${logPath}`);
} catch (err) {
  const stderr = err.stderr || "";
  const stdout = err.stdout || "";
  writeFileSync(logPath, header + stdout + "\n--- STDERR ---\n" + stderr);
  console.error(`❌ ${name} failed – log saved to ${logPath}`);
  process.exit(1);
}
