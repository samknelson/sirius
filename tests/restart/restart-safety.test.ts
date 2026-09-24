/**
 * The two safety rules behind the admin Restart page.
 *
 * Both are silent when they break: a wrong supervision verdict shows the
 * operator a confident "the app should come back" and hides the typed
 * confirmation, and a missing server-side confirmation check makes the gate
 * pure decoration. Neither crashes, neither fails typecheck, and both take
 * the site down when they are wrong — the page's whole purpose is to be
 * trustworthy about a possibly one-way action.
 *
 * Both rules are pure functions of structured facts, so they are asserted
 * directly: no server, no database, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveSupervision,
  fetchEcsMetadata,
  type ContainerFacts,
  type EcsLookup,
  type SupervisionInput,
} from "../../server/services/container-facts";
import {
  buildRestartPrediction,
  checkRestartConfirmation,
  RESTART_CONFIRM_PHRASE,
} from "../../server/services/restart-control";

function supervisionInput(overrides: Partial<SupervisionInput> = {}): SupervisionInput {
  return { platform: "docker", isPid1: true, pid: 1, ecs: null, ...overrides };
}

const ECS_SERVICE_TASK: EcsLookup = {
  reachable: true,
  metadata: { cluster: "prod", family: "sirius", revision: "42", serviceName: "sirius-web" },
};

const ECS_ONE_OFF_TASK: EcsLookup = {
  reachable: true,
  // A `RunTask` document carries cluster/family/revision but names no service.
  metadata: { cluster: "prod", family: "sirius", revision: "42" },
};

describe("supervision is never guessed", () => {
  it("an ECS task naming its service is supervised", () => {
    const { supervised, supervisionReason } = deriveSupervision(
      supervisionInput({ platform: "ecs", ecs: ECS_SERVICE_TASK }),
    );
    expect(supervised).toBe(true);
    expect(supervisionReason).toContain("sirius-web");
  });

  it("an ECS one-off task is unknown, not supervised", () => {
    // The failure this pins: treating "running on ECS" as proof of a service.
    // A RunTask that stops is never replaced, and the page would have
    // promised otherwise.
    const { supervised, supervisionReason } = deriveSupervision(
      supervisionInput({ platform: "ecs", ecs: ECS_ONE_OFF_TASK }),
    );
    expect(supervised).toBeNull();
    expect(supervisionReason).toMatch(/one-off|does not name a service/i);
  });

  it("an ECS task whose metadata could not be read is unknown", () => {
    const { supervised } = deriveSupervision(
      supervisionInput({
        platform: "ecs",
        ecs: { reachable: false, reason: "timed out" },
      }),
    );
    expect(supervised).toBeNull();
  });

  it("Kubernetes is unknown — restartPolicy may be Never and is not visible", () => {
    const { supervised, supervisionReason } = deriveSupervision(
      supervisionInput({ platform: "kubernetes" }),
    );
    expect(supervised).toBeNull();
    expect(supervisionReason).toMatch(/Never/);
  });

  it("a plain container, a bare host and an unidentified platform are all unknown", () => {
    for (const platform of ["docker", "host", "unknown"] as const) {
      expect(deriveSupervision(supervisionInput({ platform })).supervised).toBeNull();
    }
  });

  it("not being the entry process downgrades any supervised verdict to unknown", () => {
    // A supervisor watches the container. Exiting a non-PID-1 process can
    // leave the container up, so no platform signal can promise a
    // replacement.
    const { supervised, supervisionReason } = deriveSupervision(
      supervisionInput({ platform: "ecs", ecs: ECS_SERVICE_TASK, isPid1: false, pid: 27 }),
    );
    expect(supervised).toBeNull();
    expect(supervisionReason).toContain("27");
  });
});

describe("the task-metadata probe only ever talks to the platform endpoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses an address that is not the link-local endpoint, without opening a socket", async () => {
    // The failure this pins: treating the endpoint address as somewhere to
    // send a request because a string said so. The address is a platform
    // detail, and anything else must degrade to "could not determine" rather
    // than reach out — otherwise the status scan becomes a request forwarder
    // for whoever can influence that string.
    const spy = vi.spyOn(globalThis, "fetch");
    const rejected = [
      "http://127.0.0.1:9200",
      "http://169.254.169.254", // the EC2 instance metadata service
      "http://internal-admin.svc.cluster.local",
      "https://example.com",
      "file:///etc/passwd",
      "http://169.254.170.2@example.com",
      "not a url",
    ];

    for (const uri of rejected) {
      const result = await fetchEcsMetadata(uri);
      expect(result.reachable, uri).toBe(false);
      expect(result.metadata, uri).toBeUndefined();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("contacts the injected link-local endpoint and does not follow a redirect", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302 }));

    const result = await fetchEcsMetadata("http://169.254.170.2/v4/abc123");

    expect(spy).toHaveBeenCalledTimes(1);
    const [target, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe("http://169.254.170.2/v4/abc123/task");
    expect(init.redirect).toBe("manual");
    expect(result.reachable).toBe(false);
    expect(result.reason).toMatch(/redirect/i);
  });
});

// ---------------------------------------------------------------------------

function facts(supervised: boolean | null): ContainerFacts {
  return {
    platform: supervised === true ? "replit" : "docker",
    platformLabel: "test",
    confidence: "high",
    inContainer: true,
    pid: 1,
    isPid1: true,
    containerRuntimeHint: null,
    supervised,
    supervisionReason: "test",
    supervisionPid1Downgraded: false,
    siblingInstancesPossible: null,
    siblingReason: "test",
    evidence: [],
    ecs: null,
    nodeVersion: process.version,
    osPlatform: "linux",
    osRelease: "0",
    hostname: "test",
    gatheredAt: new Date().toISOString(),
  };
}

describe("the restart confirmation is enforced by the server", () => {
  it("an unsupervised restart is refused without the phrase", () => {
    // The failure this pins: the gate living only in the page, so a direct
    // API call, a script, or a client built before the gate existed restarts
    // production without acknowledging that it may not come back.
    for (const confirm of [undefined, null, "", "yes", "restart", " RESTART "]) {
      const result = checkRestartConfirmation(facts(null), confirm);
      const acceptable = confirm === " RESTART ";
      expect(result.ok, `confirm=${JSON.stringify(confirm)}`).toBe(acceptable);
    }
  });

  it("an unsupervised restart is allowed with the exact phrase", () => {
    expect(checkRestartConfirmation(facts(null), RESTART_CONFIRM_PHRASE).ok).toBe(true);
  });

  it("a supervised restart needs no phrase", () => {
    expect(checkRestartConfirmation(facts(true), undefined).ok).toBe(true);
  });

  it("what the page shows and what the server enforces come from one decision", () => {
    for (const supervised of [true, false, null] as const) {
      const prediction = buildRestartPrediction(facts(supervised));
      const withoutPhrase = checkRestartConfirmation(facts(supervised), undefined).ok;
      expect(withoutPhrase).toBe(!prediction.requiresTypedConfirmation);
    }
  });
});
