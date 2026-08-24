/**
 * Container facts service (Task #1258).
 *
 * Gathers everything this process can honestly determine about WHERE it is
 * running and WHETHER anything would start it again if it exited. It is the
 * single source of truth for two consumers:
 *
 *   - the "Container Information" system-status plugin
 *     (`server/plugins/system/status/plugins/container.ts`), which renders
 *     these facts as human-readable messages and detail rows;
 *   - the admin Restart page's prediction and confirmation strength
 *     (`server/services/restart-control.ts`).
 *
 * The rendered strings are DISPLAY ONLY. Nothing may parse them: every
 * decision is taken from the structured result below.
 *
 * Honesty rules baked into the shape:
 *   - `supervised` is `boolean | null`. `null` means "could not be
 *     determined", never "probably fine". A plain Docker container cannot
 *     see its own restart policy, so `null` is the correct — and common —
 *     answer.
 *   - `confidence` records how strong the platform identification is.
 *   - every conclusion carries its `evidence`, so an operator can judge it.
 */
import { existsSync, readFileSync } from "node:fs";
import { hostname, platform as osPlatform, release as osRelease } from "node:os";
import { getPlatformEnvironmentVariable } from "../config/env-registry";

/** How long the ECS task-metadata HTTP call may take before we give up. */
const ECS_METADATA_TIMEOUT_MS = 1_500;

/**
 * The only addresses the task-metadata document may be fetched from.
 *
 * The endpoint AWS injects is always link-local: the container-agent address
 * for task metadata v3/v4, and the EKS Pod Identity address alongside it.
 * Pinning them means the address is treated as the fixed platform detail it
 * is, rather than as somewhere to send a request because a string said so —
 * so a wrong or tampered value can only ever produce "could not determine",
 * never an outbound request to somewhere else on the network.
 */
const ECS_METADATA_ALLOWED_HOSTS = new Set([
  "169.254.170.2",
  "169.254.170.23",
  "[fd00:ec2::23]",
]);

export type ContainerPlatform =
  | "ecs"
  | "kubernetes"
  | "replit"
  | "docker"
  | "host"
  | "unknown";

/** How strongly the platform identification is supported by the evidence. */
export type FactConfidence = "high" | "medium" | "unknown";

/** One observation and what it lets us conclude. */
export interface ContainerEvidence {
  id: string;
  /** What was inspected. */
  label: string;
  /** What was found (already safe to display). */
  finding: string;
  /** What that finding supports. */
  supports: string;
}

/** The subset of the ECS task metadata document worth showing an operator. */
export interface EcsTaskMetadata {
  cluster?: string;
  family?: string;
  revision?: string;
  taskArn?: string;
  desiredStatus?: string;
  knownStatus?: string;
  launchType?: string;
  availabilityZone?: string;
  /**
   * Present only when the task was launched by an ECS **service**. This is
   * the one authoritative supervision signal ECS gives a task about itself:
   * a service replaces a stopped task, a one-off `RunTask` is not replaced,
   * and nothing else in the document distinguishes them.
   */
  serviceName?: string;
}

export interface EcsLookup {
  /** True when the metadata endpoint answered with a usable document. */
  reachable: boolean;
  /** Why the lookup produced nothing (unset endpoint, timeout, HTTP error). */
  reason?: string;
  metadata?: EcsTaskMetadata;
}

export interface ContainerFacts {
  platform: ContainerPlatform;
  /** Operator-facing name of the platform, e.g. "Amazon ECS". */
  platformLabel: string;
  confidence: FactConfidence;

  /** True/false when container evidence is conclusive, null when it is not. */
  inContainer: boolean | null;
  /** Process id of this process. */
  pid: number;
  /** True when this process is PID 1 (the container's entry process). */
  isPid1: boolean;
  /** Container runtime named by the control-group file, when it names one. */
  containerRuntimeHint: string | null;

  /**
   * Whether something outside this process would start a replacement if it
   * exited. `null` means undetermined — the Restart page treats that as
   * "the app may not come back" and demands a typed confirmation.
   */
  supervised: boolean | null;
  supervisionReason: string;
  /**
   * True when a platform supervision signal was overridden because this
   * process is not the container's entry process. See {@link deriveSupervision}.
   */
  supervisionPid1Downgraded: boolean;

  /**
   * Whether other instances of this application may be serving alongside
   * this process. `null` means undetermined. A process can only ever end
   * itself, so this changes what a restart is worth.
   */
  siblingInstancesPossible: boolean | null;
  siblingReason: string;

  evidence: ContainerEvidence[];
  /** null when this platform has no task-metadata service to consult. */
  ecs: EcsLookup | null;

  nodeVersion: string;
  osPlatform: string;
  osRelease: string;
  hostname: string;
  /** ISO timestamp of when these facts were gathered. */
  gatheredAt: string;
}

const PLATFORM_LABELS: Record<ContainerPlatform, string> = {
  ecs: "Amazon ECS",
  kubernetes: "Kubernetes",
  replit: "Replit Deployment",
  docker: "Container (no orchestrator identified)",
  host: "Directly on a host (not containerised)",
  unknown: "Could not be determined",
};

/**
 * Read a file, returning undefined instead of throwing. Every filesystem
 * probe here is best-effort: a hardened image may hide the control-group
 * file entirely, and that must read as "no evidence", not as a failure.
 */
function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Name the container runtime the control-group file points at, if any. */
function detectRuntimeFromCgroup(cgroup: string | undefined): string | null {
  if (!cgroup) return null;
  if (cgroup.includes("kubepods")) return "kubernetes";
  if (cgroup.includes("/ecs/")) return "ecs";
  if (cgroup.includes("docker")) return "docker";
  if (cgroup.includes("containerd")) return "containerd";
  if (cgroup.includes("libpod") || cgroup.includes("podman")) return "podman";
  return null;
}

/**
 * Fetch the ECS task metadata document. Deliberately short-fused: this runs
 * inside the status collector's timeout sandbox, and an unreachable metadata
 * service must degrade to an informational "could not determine", never to a
 * hung scan.
 */
export async function fetchEcsMetadata(uri: string): Promise<EcsLookup> {
  // Refuse anything that is not the link-local endpoint AWS injects, before a
  // socket is opened. Credentials in the URL are rejected too: the real
  // endpoint never carries them, and they are only ever an attempt to make a
  // host check read the wrong part of the string.
  let target: URL;
  try {
    target = new URL(`${uri.replace(/\/+$/, "")}/task`);
  } catch {
    return {
      reachable: false,
      reason: "The task metadata endpoint address is not a valid URL.",
    };
  }
  if (
    target.protocol !== "http:" ||
    !ECS_METADATA_ALLOWED_HOSTS.has(target.host.replace(/:\d+$/, "")) ||
    target.username !== "" ||
    target.password !== ""
  ) {
    return {
      reachable: false,
      reason:
        "The task metadata endpoint address is not the link-local address AWS injects, " +
        "so it was not contacted.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ECS_METADATA_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      // A redirect would move the request off the address just validated, so
      // it is a refusal rather than something to follow.
      redirect: "manual",
    });
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      return {
        reachable: false,
        reason: "The task metadata service redirected the request, which is not followed.",
      };
    }
    if (!response.ok) {
      return {
        reachable: false,
        reason: `The task metadata service answered with HTTP ${response.status}.`,
      };
    }
    const body = (await response.json()) as Record<string, unknown>;
    const str = (key: string): string | undefined => {
      const value = body[key];
      return typeof value === "string" && value !== "" ? value : undefined;
    };
    return {
      reachable: true,
      metadata: {
        cluster: str("Cluster"),
        family: str("Family"),
        revision: str("Revision"),
        taskArn: str("TaskARN"),
        desiredStatus: str("DesiredStatus"),
        knownStatus: str("KnownStatus"),
        launchType: str("LaunchType"),
        availabilityZone: str("AvailabilityZone"),
        serviceName: str("ServiceName"),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `The task metadata service did not answer within ${ECS_METADATA_TIMEOUT_MS}ms.`
        : `The task metadata service could not be reached — ${
            error instanceof Error ? error.message : String(error)
          }`;
    return { reachable: false, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Inputs to the supervision decision. Kept explicit so it can be reasoned about. */
export interface SupervisionInput {
  platform: ContainerPlatform;
  /** True when this process is the container's entry process. */
  isPid1: boolean;
  pid: number;
  /** ECS task metadata lookup, when this platform has one. */
  ecs: EcsLookup | null;
}

/**
 * Decide whether anything would start a replacement if this process exited.
 *
 * PURE — no environment, no filesystem, no network — so the rule can be
 * reasoned about and tested directly. The default is `null` ("cannot be
 * determined"), and a platform only escapes it by presenting an
 * *authoritative* signal about itself. Guessing here is the one failure the
 * whole feature exists to avoid: `true` suppresses the typed confirmation and
 * promises the operator the site will come back.
 *
 * What counts as authoritative, and what deliberately does not:
 *
 *   - **ECS**: only the task metadata document naming a `ServiceName`. A
 *     service replaces a stopped task; a one-off `RunTask` is not replaced,
 *     and nothing else in the document tells the two apart. "Running on ECS"
 *     is therefore NOT sufficient.
 *   - **Kubernetes**: nothing. The pod's `restartPolicy` lives in the pod
 *     spec, is not projected into the container, and `Never` is legal. The
 *     common default being `Always` is not a fact about THIS pod.
 *   - **Replit deployments**: the deployment supervisor is a property of the
 *     platform itself, not of a per-deployment setting, so the marker is
 *     conclusive.
 *   - **Plain container / host / unidentified**: nothing is knowable.
 *
 * Finally, being supervised is worthless if this process is not the one the
 * supervisor watches. A non-PID-1 process can exit without the container
 * exiting, so no supervisor ever notices — that downgrades any `true` back to
 * `null`, whatever the platform said.
 */
export function deriveSupervision(input: SupervisionInput): {
  supervised: boolean | null;
  supervisionReason: string;
  /**
   * True when the platform DID present a supervision signal but not being the
   * entry process overrode it. Structured so the restart prediction can avoid
   * repeating the point instead of inspecting the reason text.
   */
  supervisionPid1Downgraded: boolean;
} {
  const { platform, isPid1, pid, ecs } = input;

  let supervised: boolean | null;
  let supervisionReason: string;

  switch (platform) {
    case "ecs":
      if (ecs?.reachable && ecs.metadata?.serviceName) {
        supervised = true;
        supervisionReason =
          `This task belongs to the ECS service "${ecs.metadata.serviceName}", and a ` +
          "service starts a replacement task when one stops.";
      } else if (ecs?.reachable) {
        supervised = null;
        supervisionReason =
          "The ECS task metadata does not name a service, so this may be a one-off task " +
          "started by hand. ECS replaces a stopped task only when it belongs to a " +
          "service; a one-off task is not replaced.";
      } else {
        supervised = null;
        supervisionReason =
          "The ECS task metadata could not be read, so whether this task belongs to a " +
          "service is unknown. Only a service task is replaced when it stops.";
      }
      break;
    case "kubernetes":
      supervised = null;
      supervisionReason =
        "The pod's restart policy is set in the pod specification and is not visible " +
        "from inside the container. It is commonly Always, but a pod set to Never is " +
        "legal and this container cannot tell which applies to it.";
      break;
    case "replit":
      supervised = true;
      supervisionReason =
        "The Replit deployment supervisor starts a fresh process when this one exits. " +
        "That is a property of the platform rather than a per-deployment setting.";
      break;
    case "docker":
      supervised = null;
      supervisionReason =
        "A container's restart policy is set outside the container and cannot be read " +
        "from inside it. Whether anything starts a replacement is not knowable here.";
      break;
    case "host":
      supervised = null;
      supervisionReason =
        "This process is not running in a container, so there is no container supervisor. " +
        "Whether a service manager would start it again cannot be determined from inside " +
        "the process.";
      break;
    default:
      supervised = null;
      supervisionReason =
        "The environment could not be identified, so nothing can be said about whether " +
        "a replacement process would be started.";
      break;
  }

  // A supervisor watches the container, not this process. If we are not the
  // entry process, our exit may leave the container up and the supervisor
  // none the wiser — so no platform signal can promise a replacement.
  let supervisionPid1Downgraded = false;
  if (supervised === true && !isPid1) {
    supervised = null;
    supervisionPid1Downgraded = true;
    supervisionReason =
      `${supervisionReason} However, this process is not the container's entry process ` +
      `(it is process ${pid}), so ending it may not end the container — in which case ` +
      "the supervisor never sees a stop and starts nothing.";
  }

  return { supervised, supervisionReason, supervisionPid1Downgraded };
}

/**
 * Gather the facts. Never throws: every probe degrades to "no evidence" so a
 * status scan or the Restart page always has something honest to show.
 */
export async function getContainerFacts(): Promise<ContainerFacts> {
  const evidence: ContainerEvidence[] = [];

  // --- container evidence -------------------------------------------------
  const dockerEnvPresent = existsSync("/.dockerenv");
  const podmanEnvPresent = existsSync("/run/.containerenv");
  const cgroup = readTextFile("/proc/1/cgroup") ?? readTextFile("/proc/self/cgroup");
  const runtimeHint = detectRuntimeFromCgroup(cgroup);

  if (dockerEnvPresent) {
    evidence.push({
      id: "dockerenv",
      label: "Docker marker file (/.dockerenv)",
      finding: "present",
      supports: "This process is running inside a container.",
    });
  }
  if (podmanEnvPresent) {
    evidence.push({
      id: "containerenv",
      label: "Podman marker file (/run/.containerenv)",
      finding: "present",
      supports: "This process is running inside a container.",
    });
  }
  if (runtimeHint) {
    evidence.push({
      id: "cgroup",
      label: "Control group membership",
      finding: `names "${runtimeHint}"`,
      supports: `The container runtime appears to be ${runtimeHint}.`,
    });
  } else if (cgroup !== undefined) {
    evidence.push({
      id: "cgroup",
      label: "Control group membership",
      finding: "no container runtime named",
      supports: "No container runtime could be identified from control groups.",
    });
  } else {
    evidence.push({
      id: "cgroup",
      label: "Control group membership",
      finding: "not readable",
      supports: "This system exposes no control-group file to inspect.",
    });
  }

  const inContainer: boolean | null =
    dockerEnvPresent || podmanEnvPresent || runtimeHint !== null
      ? true
      : cgroup !== undefined
        ? false
        : null;

  // --- process identity ---------------------------------------------------
  const pid = process.pid;
  const isPid1 = pid === 1;
  evidence.push({
    id: "pid",
    label: "Process id",
    finding: String(pid),
    supports: isPid1
      ? "This process is the container's entry process; ending it ends the container."
      : "This process is not the entry process, so ending it may not end the container.",
  });

  // --- platform environment ----------------------------------------------
  // Platform markers are evidence about the host, not configuration, so they
  // are read from the process environment only — see
  // getPlatformEnvironmentVariable. An in-app override must not be able to
  // forge "you are running on ECS" or redirect the metadata request.
  const ecsMetadataUri =
    getPlatformEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4") ||
    getPlatformEnvironmentVariable("ECS_CONTAINER_METADATA_URI");
  const kubernetesHost = getPlatformEnvironmentVariable("KUBERNETES_SERVICE_HOST");
  const awsExecutionEnv = getPlatformEnvironmentVariable("AWS_EXECUTION_ENV");
  const replitDeployment = getPlatformEnvironmentVariable("REPLIT_DEPLOYMENT") === "1";

  if (ecsMetadataUri) {
    evidence.push({
      id: "ecs-metadata-uri",
      label: "ECS task metadata endpoint",
      finding: "injected into the environment",
      supports: "Amazon ECS is running this task.",
    });
  }
  if (awsExecutionEnv) {
    evidence.push({
      id: "aws-execution-env",
      label: "AWS execution environment",
      finding: awsExecutionEnv,
      supports: "The AWS runtime identifies itself in the environment.",
    });
  }
  if (kubernetesHost) {
    evidence.push({
      id: "kubernetes",
      label: "Kubernetes API service address",
      finding: "injected into the environment",
      supports: "A Kubernetes kubelet is running this container.",
    });
  }
  if (replitDeployment) {
    evidence.push({
      id: "replit",
      label: "Replit deployment marker",
      finding: "set",
      supports: "This process is running inside a Replit deployment.",
    });
  }

  // --- platform decision --------------------------------------------------
  let platform: ContainerPlatform;
  let confidence: FactConfidence;
  if (ecsMetadataUri) {
    platform = "ecs";
    confidence = "high";
  } else if (kubernetesHost) {
    platform = "kubernetes";
    confidence = "high";
  } else if (replitDeployment) {
    platform = "replit";
    confidence = "high";
  } else if (inContainer === true) {
    platform = "docker";
    confidence = "medium";
  } else if (inContainer === false) {
    platform = "host";
    confidence = "medium";
  } else {
    platform = "unknown";
    confidence = "unknown";
  }

  // --- ECS task metadata --------------------------------------------------
  const ecs: EcsLookup | null = ecsMetadataUri
    ? await fetchEcsMetadata(ecsMetadataUri)
    : null;
  if (ecs && !ecs.reachable) {
    evidence.push({
      id: "ecs-metadata",
      label: "ECS task metadata document",
      finding: "not retrieved",
      supports: ecs.reason ?? "The task metadata could not be read.",
    });
  } else if (ecs?.metadata) {
    evidence.push({
      id: "ecs-metadata",
      label: "ECS task metadata document",
      finding: "retrieved",
      supports: "Cluster, family and revision are known for this task.",
    });
  }

  // --- supervision --------------------------------------------------------
  const { supervised, supervisionReason, supervisionPid1Downgraded } = deriveSupervision({
    platform,
    isPid1,
    pid,
    ecs,
  });

  // --- siblings -----------------------------------------------------------
  let siblingInstancesPossible: boolean | null;
  let siblingReason: string;
  switch (platform) {
    case "ecs":
      siblingInstancesPossible = true;
      siblingReason =
        "An ECS service can run several tasks behind the same load balancer. This process " +
        "can only end itself — the other tasks keep running the old configuration.";
      break;
    case "kubernetes":
      siblingInstancesPossible = true;
      siblingReason =
        "A Kubernetes deployment can run several replicas. This process can only end " +
        "itself — the other replicas keep running the old configuration.";
      break;
    case "replit":
      siblingInstancesPossible = false;
      siblingReason = "A Replit deployment serves this application from a single process.";
      break;
    default:
      siblingInstancesPossible = null;
      siblingReason =
        "Whether other instances of this application are serving alongside this one cannot " +
        "be determined from inside the process.";
      break;
  }

  return {
    platform,
    platformLabel: PLATFORM_LABELS[platform],
    confidence,
    inContainer,
    pid,
    isPid1,
    containerRuntimeHint: runtimeHint,
    supervised,
    supervisionReason,
    supervisionPid1Downgraded,
    siblingInstancesPossible,
    siblingReason,
    evidence,
    ecs,
    nodeVersion: process.version,
    osPlatform: osPlatform(),
    osRelease: osRelease(),
    hostname: hostname(),
    gatheredAt: new Date().toISOString(),
  };
}
