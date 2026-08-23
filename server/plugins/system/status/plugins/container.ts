import { registerSystemStatusPlugin } from "../registry";
import type { StatusDetailRow, StatusMessage } from "../types";
import {
  getContainerFacts,
  type ContainerFacts,
} from "../../../../services/container-facts";

/**
 * Container Information (Task #1258).
 *
 * Renders the container facts service as status messages plus a details
 * drill-down. This plugin is the ONLY place these facts are turned into
 * prose — the admin Restart page embeds this plugin's own output rather than
 * detecting anything a second time, and takes its restart prediction from the
 * facts service's structured result.
 *
 * Scan mode: "scan-and-cache". Where the process is running cannot change
 * while the process lives, and the scan makes a network call to the task
 * metadata service — exactly the profile a cached scan exists for.
 *
 * Timeout: 5s, comfortably above the facts service's own 1.5s metadata
 * budget, so a slow metadata service surfaces as its own honest "could not
 * determine" message rather than as the collector's blunt "scan timed out".
 */

/** Obfuscate an ARN-like identifier: keep the tail, hide the account id. */
function obfuscateArn(arn: string): string {
  const parts = arn.split(":");
  if (parts.length < 6) return arn;
  // arn:aws:ecs:<region>:<account>:task/<cluster>/<id>
  parts[4] = "•".repeat(6);
  return parts.join(":");
}

function supervisionMessage(facts: ContainerFacts): StatusMessage {
  if (facts.supervised === true) {
    return {
      priority: "info",
      title: "Supervised: a replacement process would be started",
      details: facts.supervisionReason,
    };
  }
  return {
    priority: "notice",
    title: "Supervision could not be established",
    details: facts.supervisionReason,
  };
}

registerSystemStatusPlugin({
  id: "container",
  name: "Container Information",
  description:
    "What this process can determine about where it is running: platform, container " +
    "evidence, process identity, and task metadata where one is available.",
  scanMode: "scan-and-cache",
  timeoutMs: 5_000,

  async scan(): Promise<StatusMessage[]> {
    const facts = await getContainerFacts();
    const messages: StatusMessage[] = [];

    // Platform. An unidentified platform is informational, not an error:
    // plenty of perfectly healthy deployments are simply not identifiable
    // from inside the process, and an alarming badge would be a lie.
    if (facts.platform === "unknown") {
      messages.push({
        priority: "notice",
        title: "Platform: could not be determined",
        details:
          "No container marker, control-group entry or platform environment variable " +
          "identified where this process is running.",
      });
    } else {
      messages.push({
        priority: "info",
        title: `Platform: ${facts.platformLabel}`,
        details:
          facts.confidence === "high"
            ? "Identified from a platform-injected environment variable."
            : "Inferred from container evidence; no orchestrator identified itself.",
      });
    }

    // Process identity.
    messages.push({
      priority: "info",
      title: facts.isPid1
        ? "This process is the container's entry process"
        : `This process is not the entry process (process ${facts.pid})`,
      details: facts.isPid1
        ? "Ending this process ends the container."
        : "Ending this process may not end the container, so a supervisor may never notice.",
    });

    messages.push(supervisionMessage(facts));

    // ECS task metadata, when there is a metadata service to consult.
    if (facts.ecs) {
      if (facts.ecs.reachable && facts.ecs.metadata) {
        const { cluster, family, revision } = facts.ecs.metadata;
        messages.push({
          priority: "info",
          title: `Task: ${family ?? "unknown family"}:${revision ?? "?"}`,
          details: `Cluster ${cluster ?? "unknown"}.`,
        });
      } else {
        messages.push({
          priority: "info",
          title: "Task metadata: could not be determined",
          details: facts.ecs.reason ?? "The task metadata service could not be reached.",
        });
      }
    }

    if (facts.siblingInstancesPossible === true) {
      messages.push({
        priority: "notice",
        title: "Other instances may be serving alongside this one",
        details: facts.siblingReason,
      });
    }

    return messages;
  },

  async details() {
    const facts = await getContainerFacts();

    const platformRows: StatusDetailRow[] = [
      {
        label: "Platform",
        description: "Where this process appears to be running.",
        value: facts.platformLabel,
        badges: [`${facts.confidence} confidence`],
        priority: facts.platform === "unknown" ? "notice" : "info",
      },
      {
        label: "In a container",
        description: "Whether container evidence was found on this filesystem.",
        value:
          facts.inContainer === null
            ? "could not be determined"
            : facts.inContainer
              ? "yes"
              : "no",
      },
      {
        label: "Container runtime",
        description: "Runtime named by this process's control-group membership.",
        value: facts.containerRuntimeHint ?? "none identified",
      },
      {
        label: "Supervision",
        description: "Whether anything would start a replacement if this process exited.",
        value:
          facts.supervised === null
            ? "could not be determined"
            : facts.supervised
              ? "yes"
              : "no",
        priority: facts.supervised === true ? "info" : "notice",
      },
      {
        label: "Reason",
        value: facts.supervisionReason,
      },
      {
        label: "Other instances possible",
        description: "Whether this application may be served by more than one process.",
        value:
          facts.siblingInstancesPossible === null
            ? "could not be determined"
            : facts.siblingInstancesPossible
              ? "yes"
              : "no",
      },
      {
        label: "Reason",
        value: facts.siblingReason,
      },
    ];

    const processRows: StatusDetailRow[] = [
      {
        label: "Process id",
        description: "1 means this process is the container's entry process.",
        value: String(facts.pid),
      },
      { label: "Node version", value: facts.nodeVersion },
      {
        label: "Operating system",
        value: `${facts.osPlatform} ${facts.osRelease}`,
      },
      {
        label: "Host name",
        description:
          "Obfuscated — under most orchestrators this is a fragment of the task or pod id.",
        // The host name is the container id under Docker and ECS: not a
        // secret, but not something to publish in full either.
        value:
          facts.hostname.length > 4
            ? `${facts.hostname.slice(0, 4)}${"•".repeat(Math.min(8, facts.hostname.length - 4))}`
            : facts.hostname,
      },
    ];

    const evidenceRows: StatusDetailRow[] = facts.evidence.map((item) => ({
      label: item.label,
      description: item.supports,
      value: item.finding,
    }));

    const groups = [
      { title: "Platform", rows: platformRows },
      { title: "Evidence", rows: evidenceRows },
      { title: "This process", rows: processRows },
    ];

    if (facts.ecs) {
      const ecsRows: StatusDetailRow[] = [];
      if (facts.ecs.reachable && facts.ecs.metadata) {
        const meta = facts.ecs.metadata;
        ecsRows.push(
          { label: "Cluster", value: meta.cluster ?? "not reported" },
          { label: "Task family", value: meta.family ?? "not reported" },
          { label: "Task revision", value: meta.revision ?? "not reported" },
          {
            label: "Task ARN",
            description: "Obfuscated — the AWS account id is hidden.",
            value: meta.taskArn ? obfuscateArn(meta.taskArn) : "not reported",
          },
          { label: "Launch type", value: meta.launchType ?? "not reported" },
          { label: "Availability zone", value: meta.availabilityZone ?? "not reported" },
          {
            label: "Status",
            value: `${meta.knownStatus ?? "unknown"} (desired ${meta.desiredStatus ?? "unknown"})`,
          },
        );
      } else {
        ecsRows.push({
          label: "Task metadata",
          description: facts.ecs.reason,
          value: "could not be determined",
          priority: "notice",
        });
      }
      groups.push({ title: "ECS task", rows: ecsRows });
    }

    groups.push({
      title: "Gathered",
      rows: [
        {
          label: "At",
          description: "When these facts were collected.",
          value: facts.gatheredAt,
        },
      ],
    });

    return { groups };
  },
});
