#!/usr/bin/env npx tsx
/**
 * Run Vitest once with its JSON reporter, then print the slowest test cases and
 * files. The report is advisory: test failures still fail the command, while a
 * budget overage is made visible for review rather than becoming a new gate.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRawProcessEnv } from "../../server/config/env-registry";

const TEST_BUDGET_MS = 250;
const FILE_BUDGET_MS = 2_000;
const output = join(tmpdir(), `sirius-vitest-slow-${process.pid}.json`);
const filters = process.argv.slice(2);

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    ...filters,
    "--reporter=json",
    `--outputFile=${output}`,
  ],
  { stdio: ["inherit", "inherit", "inherit"], env: getRawProcessEnv() },
);

interface AssertionResult {
  ancestorTitles?: string[];
  title?: string;
  duration?: number;
}

interface FileResult {
  name?: string;
  startTime?: number;
  endTime?: number;
  assertionResults?: AssertionResult[];
}

try {
  const report = JSON.parse(readFileSync(output, "utf8")) as { testResults?: FileResult[] };
  const files = (report.testResults ?? []).map((file) => ({
    name: file.name ?? "(unknown file)",
    duration: Math.max(0, (file.endTime ?? 0) - (file.startTime ?? 0)),
  })).filter((file) => file.duration >= FILE_BUDGET_MS)
    .sort((a, b) => b.duration - a.duration);

  const tests = (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test) => ({
      name: [...(test.ancestorTitles ?? []), test.title ?? "(unknown test)"].join(" > "),
      file: file.name ?? "(unknown file)",
      duration: test.duration ?? 0,
    })),
  ).filter((test) => test.duration >= TEST_BUDGET_MS)
    .sort((a, b) => b.duration - a.duration);

  console.log(`\nSlow-test budget: ${TEST_BUDGET_MS} ms/test, ${FILE_BUDGET_MS} ms/file`);
  if (tests.length === 0 && files.length === 0) {
    console.log("No budget overruns.");
  } else {
    if (tests.length > 0) {
      console.log("\nSlow tests:");
      for (const test of tests.slice(0, 30)) {
        console.log(`  ${test.duration.toFixed(0).padStart(6)} ms  ${test.name} (${test.file})`);
      }
    }
    if (files.length > 0) {
      console.log("\nSlow files:");
      for (const file of files.slice(0, 30)) {
        console.log(`  ${file.duration.toFixed(0).padStart(6)} ms  ${file.name}`);
      }
    }
  }
} catch (error) {
  console.error(`[test:slow] Could not read Vitest JSON report: ${error instanceof Error ? error.message : String(error)}`);
  if (result.status === 0) process.exitCode = 2;
} finally {
  rmSync(output, { force: true });
}

if (result.status !== 0) process.exitCode = result.status ?? 1;