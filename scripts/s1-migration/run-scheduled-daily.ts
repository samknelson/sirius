/**
 * Production scheduler entrypoint. This deliberately has no forwarding CLI:
 * the scheduled command cannot gain operator-only sync flags.
 */
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getRawProcessEnv } from "./lib/script-env";
import {
  assertNoForbiddenScheduledFlags,
  SCHEDULED_SYNC_ARGS,
  sanitizeDailySummary,
  summaryMessage,
  type DailySyncReport,
} from "./lib/daily-automation";
import { publishS1AutomationAlert } from "./lib/sns-alert";

async function run(): Promise<void> {
  assertNoForbiddenScheduledFlags(process.argv.slice(2));
  if (process.argv.length > 2) throw new Error("scheduled daily sync accepts no command-line arguments");

  const resultPath = join(tmpdir(), `s1-scheduled-daily-${randomUUID()}.json`);
  let childExit = 1;
  try {
    childExit = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        "npx",
        [...SCHEDULED_SYNC_ARGS],
        { stdio: "inherit", env: { ...getRawProcessEnv(), S1_RESULT_JSON_PATH: resultPath } },
      );
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });

    const report = JSON.parse(await readFile(resultPath, "utf8")) as DailySyncReport;
    const summary = sanitizeDailySummary(report);
    const message = summaryMessage(summary);
    console.log(`[scheduled-daily] SANITIZED_SUMMARY ${message}`);

    await publishS1AutomationAlert(
      summary.status === "failure"
        ? "S1 daily sync failed"
        : summary.status === "findings"
          ? "S1 daily sync completed with findings"
          : "S1 daily sync completed",
      message,
    );
    if (childExit !== 0 || summary.result !== "PASS") process.exitCode = 1;
  } catch (error) {
    const message = JSON.stringify({
      event: "s1-daily-sync-wrapper-failed",
      failureClass: error instanceof SyntaxError ? "invalid-result" : "wrapper-error",
      childExit,
    });
    console.error(`[scheduled-daily] FAIL ${message}`);
    await publishS1AutomationAlert("S1 daily sync failed", message).catch((publishError) => {
      console.error(`[scheduled-daily] alert publish failed: ${(publishError as Error).name}`);
    });
    process.exitCode = 1;
  } finally {
    await rm(resultPath, { force: true });
  }
}

run().catch((error) => {
  console.error(`[scheduled-daily] FATAL ${(error as Error).name}`);
  process.exit(1);
});
