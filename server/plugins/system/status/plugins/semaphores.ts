import { semaphoreStorage, SEMAPHORE_STATUS_LIMIT } from "../../../../storage/system/semaphores";
import type { SemaphoreStatusSnapshot } from "@shared/schema/system/semaphores-schema";
import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage, SystemStatusPlugin } from "../types";

function describe(entry: SemaphoreStatusSnapshot["entries"][number]): string {
  const owner = entry.ownerProcessId
    ? `Owner boot identity: ${entry.ownerProcessId}. Name: ${entry.ownerName ?? "(unavailable)"}. Process telemetry: ${entry.ownerTelemetry}.`
    : "No owner.";
  return `${owner} Lease expiry (database clock, UTC): ${entry.expiresAt?.toISOString() ?? "none"}.`;
}

function notes(snapshot: SemaphoreStatusSnapshot): StatusMessage[] {
  const messages: StatusMessage[] = [{
    priority: "info",
    title: `Database observation: ${snapshot.observedAt.toISOString()}`,
    details: "Read-only snapshot, not a live guarantee. Lease state uses the database clock, not process heartbeats. Missing, stale, ended, or purged process telemetry does not revoke a lease. An expired lease does not prove old work stopped.",
    link: { href: "/config/processes", label: "View process telemetry" },
  }];
  if (snapshot.truncated) messages.push({
    priority: "notice", title: `Showing the first ${SEMAPHORE_STATUS_LIMIT} resources`,
    details: "More semaphore resources exist. The scheduler resource is shown first; remaining resources are ordered by key.",
  });
  if (!snapshot.entries.length) messages.push({
    priority: "info", title: "No semaphore resources recorded",
    details: "No ownership is recorded in this snapshot. This does not establish whether processes or jobs are running.",
  });
  return messages;
}

export const semaphoreStatusPlugin: SystemStatusPlugin = {
  id: "semaphores",
  name: "Cron scheduling and job ownership",
  description: "Current semaphore leases: cron:scheduler owns automatic scheduling; cron:execution:<job> owns a job's execution lease.",
  scanMode: "immediate",
  async scan() {
    const snapshot = await semaphoreStorage.status();
    return [
      ...notes(snapshot),
      ...snapshot.entries.map((entry): StatusMessage => ({
        priority: entry.state === "expired" ? "notice" : "info",
        title: `${entry.key}: ${entry.state}`,
        details: describe(entry),
      })),
    ];
  },
  async details() {
    const snapshot = await semaphoreStorage.status();
    return {
      groups: [
        { title: "Snapshot", rows: notes(snapshot).map(message => ({
          label: message.title, description: message.details, priority: message.priority,
        })) },
        { title: "Semaphore resources", rows: snapshot.entries.map(entry => ({
          label: entry.key,
          badges: [entry.state],
          value: describe(entry),
          priority: entry.state === "expired" ? "notice" as const : "info" as const,
        })) },
      ],
    };
  },
};

registerSystemStatusPlugin(semaphoreStatusPlugin);
