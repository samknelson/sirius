import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The T631 connection's own rules, pinned where they can't drift.
 *
 * T631 is the first vendor whose credential is a compound one: the framework
 * resolves exactly one secret per connection, and T631 needs two tokens, so the
 * secret is a JSON object the plugin decodes. Two things about that are easy to
 * get wrong and silent when wrong:
 *
 *  - A credential that is absent, unparseable or half-filled has to be REPORTED
 *    with the reason, not swallowed into a generic "could not reach T631",
 *    because those send an operator to entirely different places.
 *  - None of those messages may carry any part of the credential. `JSON.parse`
 *    in particular quotes the offending input back in its own message, which is
 *    exactly how a credential fragment reaches a log line, so the canary below
 *    checks the value never appears in anything the plugin produces.
 *
 * These exercise the plugin's own behaviour, so they reach its handlers through
 * the framework's internal accessor rather than through `wcRequest` — what is
 * under test here is what the plugin does with a credential, not the cache, the
 * refusal or the count that the framework applies around it. The framework's
 * request registration is captured rather than discarded so the test can also
 * assert the framework was told about every operation.
 */

interface CapturedRegistration {
  service: string;
  requestType: string;
  operation: string;
  needsWritableDatabase?: boolean;
}

const registrations: CapturedRegistration[] = [];

vi.mock("../../server/services/webclient/uncached", () => ({
  registerUncachedWcVendorRequest: (entry: CapturedRegistration) => {
    registrations.push(entry);
  },
}));

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

const { getWcVendorHandler, getWcVendorPlugin } = await import(
  "../../server/plugins/wc-vendors/registry"
);
const { T631_ACTIONS, T631_PLUGIN_ID, T631_COMPONENT, T631ConfigurationError } =
  await import("../../server/plugins/wc-vendors/plugins/sitespecific-t631");

const GOOD_SETTINGS = {
  url: "https://t631.example.invalid/generic.json",
  accountId: "acct-1",
  employerId: "emp-1",
};

/** A value that must never appear in any message the plugin produces. */
const CANARY = "CANARY-4f3a9c2e-token-value";

/**
 * Nothing the plugin hands back carries the credential — not the whole value
 * and not a recognisable piece of it.
 *
 * The fragment half matters as much as the whole: a "first four and last four"
 * rendering is still credential bytes in a log line, and those are the two ends
 * an attacker holding the middle would want. Checking only for the complete
 * string would pass a masked leak.
 */
function expectNoCredentialAnywhere(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(CANARY);
  for (const fragment of [
    CANARY.slice(0, 6),
    CANARY.slice(-6),
    Buffer.from(CANARY).toString("base64").slice(0, 8),
  ]) {
    expect(serialized).not.toContain(fragment);
  }
}

function context(apiKey: string, data: Record<string, unknown> = GOOD_SETTINGS) {
  return {
    credential: {
      secretName: "T631_CREDENTIAL",
      value: apiKey,
    },
    config: {
      id: "cfg-1",
      name: "Teamsters 631",
      data: { secretName: "T631_CREDENTIAL", ...data },
    },
  } as any;
}

function plugin() {
  const found = getWcVendorPlugin(T631_PLUGIN_ID);
  if (!found) throw new Error("the T631 vendor plugin is not registered");
  return found;
}

/**
 * The plugin's own handler for one operation.
 *
 * Registered plugins carry only what a vendor CAN do; the runnable half lives
 * behind this accessor, which is the framework's door and, here, the test's.
 */
function handler(operation: string) {
  const found = getWcVendorHandler(T631_PLUGIN_ID, operation as any);
  if (!found) throw new Error(`the T631 vendor registered no '${operation}' handler`);
  return found;
}

async function runTest(apiKey: string, data?: Record<string, unknown>) {
  return (await handler("test-connection")(
    context(apiKey, data),
    undefined as never,
  )) as any;
}

beforeEach(() => {
  fetchSpy.mockReset();
});

describe("the T631 vendor plugin", () => {
  it("uses the site-specific plugin id", () => {
    expect(T631_PLUGIN_ID).toBe("sitespecific-t631");
  });

  it("is gated on its own component, not on the kind", () => {
    expect(plugin().requiredComponent).toBe(T631_COMPONENT);
  });

  it("declares that the framework must resolve its named credential", () => {
    expect(plugin().credential).toEqual({
      secretName: "required",
      setupGuidance:
        "Enter the environment-secret name here, not a token or JSON value. The value stored in that secret must be a JSON object containing both T631 tokens:",
      setupExample:
        '{"accessToken":"<access-token>","employerToken":"<employer-token>"}',
    });
  });

  it("puts every remote action on the web client framework as a read", () => {
    const t631 = registrations.filter((entry) => entry.service === "T631");
    const types = t631.map((entry) => entry.requestType).sort();
    expect(types).toEqual([...T631_ACTIONS, "test-connection"].sort());
    // Every one is a read that records nothing here, so a read-only site can
    // still run them — the diagnostics ping most of all.
    for (const entry of t631) {
      expect(entry.needsWritableDatabase).toBe(false);
    }
  });

  it("keeps the remote action names as the framework request types", () => {
    // These names are what the usage figures and the diagnostics page are
    // recorded under; renaming one silently starts a new counter.
    expect(T631_ACTIONS).toContain("sirius_service_ping");
    expect(T631_ACTIONS).toContain("sirius_edls_server_worker_list");
    expect(T631_ACTIONS).toContain("sirius_edls_server_tos_list");
    expect(T631_ACTIONS).toContain("sirius_dispatch_group_search");
    expect(T631_ACTIONS).toContain("sirius_dispatch_facility_dropdown");
  });
});

describe("an unusable T631 credential", () => {
  it("is reported by the connection test, naming the secret, when it is absent", async () => {
    const result = await runTest("");
    expect(result.connected).toBe(false);
    expect(result.error.message).toContain("T631_CREDENTIAL");
    expect(result.error.message).toContain("not set");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never quotes the credential back when it is not JSON", async () => {
    const result = await runTest(CANARY);
    expect(result.connected).toBe(false);
    expect(result.error.message).toContain("not valid JSON");
    expect(result.error.message).not.toContain(CANARY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is refused when it is JSON but not an object", async () => {
    const result = await runTest(JSON.stringify([CANARY]));
    expect(result.connected).toBe(false);
    expect(result.error.message).not.toContain(CANARY);
  });

  it("names the missing token without echoing the one that is present", async () => {
    const result = await runTest(JSON.stringify({ accessToken: CANARY }));
    expect(result.connected).toBe(false);
    expect(result.error.message).toContain("employerToken");
    expect(result.error.message).not.toContain(CANARY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats a blank token as missing rather than sending it", async () => {
    const result = await runTest(
      JSON.stringify({ accessToken: "access-token", employerToken: "   " }),
    );
    expect(result.connected).toBe(false);
    expect(result.error.message).toContain("employerToken");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a token too short to redact, rather than mangling the reply", async () => {
    // Redaction finds the token's own characters in whatever comes back. A
    // two-character token matches everywhere, so the choice would be between
    // shredded diagnostics and an unredacted credential. Neither is acceptable,
    // so the credential is refused instead.
    const result = await runTest(
      JSON.stringify({ accessToken: "ab", employerToken: "cd" }),
    );
    expect(result.connected).toBe(false);
    expect(result.error.message).toContain("accessToken");
    expect(result.error.message).toContain("employerToken");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops a remote action outright rather than reporting a failed call", async () => {
    // Misconfiguration has always been thrown rather than dressed up as a
    // failed request, because a scheduled sync must not read it as "T631 said
    // no workers" and start deactivating people.
    const run = handler("sirius_edls_server_worker_list");
    await expect(
      run(context(JSON.stringify({ accessToken: "a" })), undefined as never),
    ).rejects.toBeInstanceOf(T631ConfigurationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("an incomplete T631 connection", () => {
  it("names the settings it is missing", async () => {
    const result = await runTest(
      JSON.stringify({ accessToken: "a", employerToken: "b" }),
      { url: "", accountId: "", employerId: "emp-1" },
    );
    expect(result.connected).toBe(false);
    expect(result.error.message).toContain("url");
    expect(result.error.message).toContain("accountId");
    expect(result.error.message).not.toContain("employerId");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a service URL that is not an absolute http URL", () => {
    const validate = plugin().validateConfig;
    expect(validate?.({ url: "not a url" }).valid).toBe(false);
    expect(validate?.({ url: "ftp://example.invalid" }).valid).toBe(false);
    expect(validate?.({ url: "https://example.invalid/x" }).valid).toBe(true);
  });
});

describe("a working T631 connection", () => {
  const credential = JSON.stringify({
    accessToken: "access-token-value",
    employerToken: CANARY,
  });

  function answerWith(body: unknown, ok = true) {
    fetchSpy.mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? "OK" : "Server Error",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(body),
    });
  }

  it("sends Basic auth built from the account id and the access token", async () => {
    answerWith({ success: true });
    await runTest(credential);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(GOOD_SETTINGS.url);
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("acct-1:access-token-value").toString("base64")}`,
    );
  });

  it("keeps the token out of the diagnostics it hands back, whole or in part", async () => {
    answerWith({ success: true, data: { tos_nodes: [] } });
    const run = handler("sirius_edls_server_tos_list");
    const result: any = await run(context(credential), undefined as never);

    // The real body carries the token; the diagnostics copy the admin page
    // renders, and the HTTP logger previews, must not.
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual([
      "sirius_edls_server_tos_list",
      "emp-1",
      CANARY,
    ]);
    expectNoCredentialAnywhere(result);
    expect(result.request.body).toEqual([
      "sirius_edls_server_tos_list",
      "emp-1",
      "(redacted)",
    ]);
    // The employer id is a setting on the connection, not a credential, so it
    // is shown whole — masking it only makes the diagnostics harder to read.
    expect(result.request.body[1]).toBe("emp-1");
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ success: true, data: { tos_nodes: [] } });
  });

  it("keeps the access token out of the Authorization it reports", async () => {
    answerWith({ success: true });
    const result: any = await runTest(credential);
    expect(result).toBeDefined();
    const run = handler("sirius_service_ping");
    const ping: any = await run(context(credential), undefined as never);
    expect(ping.request.headers.Authorization).toBe("Basic (redacted)");
    expectNoCredentialAnywhere(ping);
  });

  it("scrubs the credential out of a reply that echoes the request back", async () => {
    // T631 answers a rejected request by quoting it, which puts the employer
    // token in the body the admin page renders and the logger previews.
    answerWith(
      { success: false, error: "rejected", echo: ["x", "emp-1", CANARY] },
      false,
    );
    const run = handler("sirius_edls_server_worker_list");
    const result: any = await run(context(credential), undefined as never);
    expect(result.success).toBe(false);
    expectNoCredentialAnywhere(result);
    // Scrubbed before parsing, so the parsed copy is clean too — not just the
    // raw text.
    expect((result.data as any).echo).toEqual(["x", "emp-1", "(redacted)"]);
  });

  it("scrubs the credential out of a transport failure's own message", async () => {
    fetchSpy.mockRejectedValue(
      new Error(`request failed while sending ${CANARY}`),
    );
    const run = handler("sirius_edls_server_worker_list");
    const result: any = await run(context(credential), undefined as never);
    expectNoCredentialAnywhere(result);
  });

  it("scrubs the credential out of the reply's own headers", async () => {
    // A debugging proxy in front of T631 that mirrors the request's
    // Authorization back would otherwise walk the credential into the
    // diagnostics page and the HTTP log.
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "x-echo-authorization": `Basic ${Buffer.from(`acct-1:access-token-value`).toString("base64")}`,
        "x-echo-token": CANARY,
      }),
      text: async () => JSON.stringify({ success: true }),
    });
    const run = handler("sirius_service_ping");
    const result: any = await run(context(credential), undefined as never);
    expectNoCredentialAnywhere(result);
    expect(result.response.headers["x-echo-token"]).toBe("(redacted)");
  });

  it("scrubs the credential out of a failing reply's status line", async () => {
    // `error` travels furthest of anything the fetch returns: the admin page
    // shows it and the cron callers put it in the message they throw and log.
    const basic = Buffer.from("acct-1:access-token-value").toString("base64");
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: `Unauthorized for Basic ${basic} / ${CANARY}`,
      headers: new Headers(),
      text: async () => "denied",
    });
    const run = handler("sirius_edls_server_worker_list");
    const result: any = await run(context(credential), undefined as never);
    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 401");
    expectNoCredentialAnywhere(result);
    expect(result.error).not.toContain(basic);
  });

  it("scrubs a token that JSON escaping spells differently in the raw text", async () => {
    // The token contains a quote, so the body's text carries `\"` where the
    // value carries `"`. A literal pass over the text alone misses it and
    // parsing then reassembles the real thing.
    const awkward = 'tok"en\\with-quotes-1234';
    const awkwardCredential = JSON.stringify({
      accessToken: "access-token-value",
      employerToken: awkward,
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => JSON.stringify({ success: true, echoed: awkward }),
    });
    const run = handler("sirius_edls_server_tos_list");
    const result: any = await run(
      context(awkwardCredential),
      undefined as never,
    );
    expect(result.data.echoed).toBe("(redacted)");
    expect(JSON.stringify(result)).not.toContain(awkward);
  });

  it("scrubs an escaped token out of a reply too malformed to parse", async () => {
    // The nastiest combination: the token contains a quote, so the reply's text
    // spells it with a backslash, AND the reply is truncated so it never
    // parses. The deep pass over the parsed value never runs, and `rawBody` is
    // what gets handed back and rendered. Only hunting the escaped spelling in
    // the text catches this one.
    const awkward = 'tok"en\\with-quotes-1234';
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      text: async () =>
        `{"success": false, "echoed": ${JSON.stringify(awkward)}, "trunc`,
    });
    const run = handler("sirius_edls_server_tos_list");
    const result: any = await run(
      context(
        JSON.stringify({
          accessToken: "access-token-value",
          employerToken: awkward,
        }),
      ),
      undefined as never,
    );
    // Confirm the test is actually exercising the unparsed path.
    expect(result.data).toBeUndefined();
    expect(result.rawBody).toBeDefined();
    expect(result.rawBody).not.toContain("tok");
    expect(JSON.stringify(result)).not.toContain(awkward);
    expect(JSON.stringify(result)).not.toContain(
      JSON.stringify(awkward).slice(1, -1),
    );
  });

  it("scrubs the longer of two overlapping tokens whole", async () => {
    // One token is a prefix of the other. Replacing the short one first would
    // leave the long one's tail sitting in the reply.
    const short = "overlap-token";
    const long = `${short}-EXTENDED-TAIL`;
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => JSON.stringify({ success: true, echoed: long }),
    });
    const run = handler("sirius_edls_server_tos_list");
    const result: any = await run(
      context(JSON.stringify({ accessToken: short, employerToken: long })),
      undefined as never,
    );
    expect(result.data.echoed).toBe("(redacted)");
    expect(JSON.stringify(result)).not.toContain("EXTENDED-TAIL");
  });

  it("reports a remote failure as a result, not as a throw", async () => {
    answerWith({ oops: true }, false);
    const run = handler("sirius_dispatch_facility_dropdown");
    const result: any = await run(context(credential), undefined as never);
    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });

  it("reports a network failure as a result, not as a throw", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    const run = handler("sirius_dispatch_group_search");
    const result: any = await run(context(credential), undefined as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });
});
