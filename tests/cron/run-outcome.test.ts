import { expect, it } from "vitest";
import { cronRunOutcome } from "../../client/src/lib/cron-run-outcome";

it("ends polling for contention and displays the server's skip reason", () => {
  expect(cronRunOutcome({ status: "skipped", output: '{"message":"Skipped: job already running."}' }))
    .toEqual({ title: "Job Skipped", description: "Skipped: job already running.", variant: "default" });
});
it("ends polling for lost ownership without claiming success", () => {
  expect(cronRunOutcome({ status: "interrupted", error: "Lock lost" }))
    .toEqual({ title: "Job Interrupted", description: "Lock lost", variant: "destructive" });
});
it("keeps polling only unfinished runs and tolerates legacy output", () => {
  expect(cronRunOutcome({ status: "running" })).toBeNull();
  expect(cronRunOutcome({ status: "error", output: "legacy" })?.title).toBe("Job Failed");
  expect(cronRunOutcome({ status: "success" })?.title).toBe("Job Completed");
});
