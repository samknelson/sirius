/**
 * The Freeman EDLS migration client's credential and outcome contract.
 *
 * Two things here fail silently if they break. A leaked access code looks like
 * an ordinary diagnostics panel on screen — nobody notices until the code is
 * in a screenshot or a support ticket. And a misread answer looks like a
 * working connection: the legacy system replies HTTP 200 with an envelope
 * carrying its own success flag, so trusting the status code alone would
 * report "connected" for a call the legacy system rejected. Both are asserted
 * against the real client with the HTTP layer stubbed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getRawProcessEnv } from "../../server/config/env-registry";
import {
  FREEMAN_EDLS_MIGRATE_PASS_VAR,
  FREEMAN_EDLS_MIGRATE_URL_VAR,
  FREEMAN_EDLS_MIGRATE_USER_VAR,
  freemanEdlsMigratePing,
  getFreemanEdlsMigrateSettingsStatus,
} from "../../server/modules/sitespecific/freeman/edls-migrate/client";

const URL_VALUE = "https://legacy.example.test/sirius_service/sirius/generic.json";
const USER_VALUE = "account-id-for-tests";
const PASS_VALUE = "s3cr3t-access-code-for-tests";

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[] = [];

function stubFetch(respond: (call: Call) => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    }),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The legacy system's success envelope, echoing the ping's arguments. */
function successEnvelope(echoed: string | null): unknown {
  return {
    success: true,
    ts: 1787661414,
    is_remote: true,
    data: { ts: 1787661414, msg: "Ping succeeded", arg_0: echoed },
    minilog: "",
    drupal_messages: [],
  };
}

function setConfigured(): void {
  const env = getRawProcessEnv();
  env[FREEMAN_EDLS_MIGRATE_URL_VAR] = URL_VALUE;
  env[FREEMAN_EDLS_MIGRATE_USER_VAR] = USER_VALUE;
  env[FREEMAN_EDLS_MIGRATE_PASS_VAR] = PASS_VALUE;
}

describe("Freeman EDLS migration client", () => {
  beforeAll(() => {
    // The module registers its own variables at load time; importing it above
    // is what makes them readable through the registry.
    setConfigured();
  });

  beforeEach(() => {
    calls = [];
    setConfigured();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates as user:password over HTTP Basic and sends the action first", async () => {
    stubFetch((call) => {
      const body = JSON.parse(String(call.init.body)) as unknown[];
      return jsonResponse(successEnvelope(String(body[1])));
    });

    const result = await freemanEdlsMigratePing();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_VALUE);
    const headers = calls[0].init.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from(`${USER_VALUE}:${PASS_VALUE}`).toString("base64")}`;
    expect(headers.Authorization, "credentials must be sent as Basic user:password").toBe(
      expected,
    );

    const sentBody = JSON.parse(String(calls[0].init.body)) as unknown[];
    expect(sentBody[0], "the action is the first element of the payload").toBe(
      "sirius_service_ping",
    );
    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(
      result.echo?.returned,
      "an echoed argument proves the payload arrived intact",
    ).toBe(true);
  });

  it("never puts the access code in the result it hands back", async () => {
    stubFetch(() => jsonResponse(successEnvelope("anything")));

    const result = await freemanEdlsMigratePing();

    expect(
      JSON.stringify(result).includes(PASS_VALUE),
      "the access code leaked into the diagnostics",
    ).toBe(false);
    expect(
      result.request?.headers.Authorization,
      "the authorization header must be reported masked",
    ).toBe("Basic ****");
    // The account id is declared non-secret and is what tells an admin which
    // account was used, so it is deliberately reported in full.
    expect(result.request?.authUser).toBe(USER_VALUE);
  });

  it("strips the access code out of anything the legacy system reflects back", async () => {
    // A legacy service — or a proxy in front of it — that echoes the
    // credential would otherwise put it straight onto an admin screen, in the
    // body, a header, or its own message text.
    const basic = Buffer.from(`${USER_VALUE}:${PASS_VALUE}`).toString("base64");
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            drupal_messages: [`Rejected credentials ${PASS_VALUE}`],
            data: { seen: { authorization: `Basic ${basic}` } },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Echoed-Auth": `Basic ${basic}`,
            },
          },
        ),
    );

    const result = await freemanEdlsMigratePing();
    const serialized = JSON.stringify(result);

    expect(serialized.includes(PASS_VALUE), "reflected access code reached the result").toBe(
      false,
    );
    expect(serialized.includes(basic), "reflected Basic value reached the result").toBe(false);
    // Redaction must not swallow the message itself — the admin still needs it.
    expect(result.remoteMessages?.[0]).toContain("Rejected credentials");
    expect(result.outcome).toBe("remote_failure");
  });

  it("strips the access code out of reflected non-JSON text", async () => {
    stubFetch(
      () =>
        new Response(`<html>auth failed for ${PASS_VALUE}</html>`, {
          status: 500,
          statusText: "Internal Server Error",
        }),
    );

    const result = await freemanEdlsMigratePing();

    expect(JSON.stringify(result).includes(PASS_VALUE)).toBe(false);
    expect(result.rawBody).toContain("auth failed for");
    expect(result.outcome).toBe("http_error");
  });

  it("strips the access code out of a thrown transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`connect failed while sending Basic ${PASS_VALUE}`);
      }),
    );

    const result = await freemanEdlsMigratePing();

    expect(JSON.stringify(result).includes(PASS_VALUE)).toBe(false);
    expect(result.outcome).toBe("network_error");
    expect(result.error).toContain("connect failed");
  });

  it("names a missing setting instead of attempting the call", async () => {
    stubFetch(() => jsonResponse(successEnvelope("unused")));
    delete getRawProcessEnv()[FREEMAN_EDLS_MIGRATE_PASS_VAR];

    const result = await freemanEdlsMigratePing();

    expect(result.outcome).toBe("not_configured");
    expect(result.success).toBe(false);
    expect(result.missingSettings).toEqual([FREEMAN_EDLS_MIGRATE_PASS_VAR]);
    expect(calls, "no call may be attempted without credentials").toHaveLength(0);

    const status = getFreemanEdlsMigrateSettingsStatus();
    expect(status.configured).toBe(false);
    expect(status.missingSettings).toEqual([FREEMAN_EDLS_MIGRATE_PASS_VAR]);
    expect(JSON.stringify(status).includes(PASS_VALUE)).toBe(false);
  });

  it("carries a refusal's own words through a 401", async () => {
    stubFetch(() => jsonResponse(["Invalid access token."], 401));

    const result = await freemanEdlsMigratePing();

    expect(result.success).toBe(false);
    expect(result.outcome).toBe("http_error");
    expect(result.response?.status).toBe(401);
    expect(
      result.remoteMessages,
      "the legacy system's own refusal text is the useful part",
    ).toEqual(["Invalid access token."]);
    expect(result.error).toContain("Invalid access token.");
    expect(JSON.stringify(result).includes(PASS_VALUE)).toBe(false);
  });

  it("treats a 200 whose envelope reports failure as a failure", async () => {
    stubFetch(() =>
      jsonResponse({ success: false, drupal_messages: ["Something went wrong."] }),
    );

    const result = await freemanEdlsMigratePing();

    expect(result.response?.status, "the transport itself succeeded").toBe(200);
    expect(result.success, "HTTP 200 is not the legacy system saying yes").toBe(false);
    expect(result.outcome).toBe("remote_failure");
    expect(result.error).toContain("Something went wrong.");
  });

  it("treats a 200 with no success flag as unrecognized, not as success", async () => {
    stubFetch(() => new Response("not json at all", { status: 200 }));

    const result = await freemanEdlsMigratePing();

    expect(result.success).toBe(false);
    expect(result.outcome).toBe("unrecognized_response");
    expect(result.rawBody).toBe("not json at all");
  });

  it("reports an unreachable host as a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND legacy.example.test");
      }),
    );

    const result = await freemanEdlsMigratePing();

    expect(result.success).toBe(false);
    expect(result.outcome).toBe("network_error");
    expect(result.response).toBeUndefined();
    expect(result.error).toContain("ENOTFOUND");
  });
});
