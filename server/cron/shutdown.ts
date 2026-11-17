import type { Server } from "http";

/**
 * Preserve normal signal exit semantics, but first revoke cron callbacks and
 * close its lock session. Does not attempt to drain/cancel running jobs.
 */
export function installCronShutdownHooks(server: Server, stop: () => Promise<void>): void {
  const onTerm = () => shutdown("SIGTERM");
  const onInt = () => shutdown("SIGINT");
  let exiting = false;
  function shutdown(signal: "SIGTERM" | "SIGINT") {
    if (exiting) return;
    exiting = true;
    void stop().finally(() => {
      process.removeListener("SIGTERM", onTerm);
      process.removeListener("SIGINT", onInt);
      process.kill(process.pid, signal);
    });
  }
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  server.once("close", () => {
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGINT", onInt);
    void stop();
  });
}
