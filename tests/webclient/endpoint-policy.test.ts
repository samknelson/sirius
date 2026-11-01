import { describe, expect, it, vi } from "vitest";
import {
  assertVendorDestinationTransport, describeVendorDestinationPolicy,
  hostMatches, normalizeHostPattern, resolveVendorDestinationPolicy,
} from "../../server/services/webclient/endpoint-policy";
import {
  createVendorHttp, isPublicVendorAddress, publicVendorLookup, validateVendorUrl,
} from "../../server/services/webclient/vendor-http";
import { setEnvironmentVariableOverride, setEnvironmentVariableOverrideSource } from "../../server/config/env-registry";
import { WcEndpointPolicyError } from "../../server/services/webclient/refusals";

const known = (id: string) => ["freeman", "optional", "disabled"].includes(id);
const required = { requiresAllowlist: true, defaultAllowedHosts: ["*.freeman.com"] };
const resolveVendorAllowedHosts = (...args: Parameters<typeof resolveVendorDestinationPolicy>) =>
  resolveVendorDestinationPolicy(...args).allowedHosts;
const policy = (allowedHosts: readonly string[] | undefined, allowPrivateAddresses = false) =>
  ({ allowedHosts, allowPrivateAddresses });

describe("vendor destination policy", () => {
  it.each([
    [], ["api.example.com"], null, {}, { allowPrivateAddresses: true },
    { allowedHosts: "api.example.com" }, { allowedHosts: [], allowPrivateAddresses: "true" },
    { allowedHosts: [], allowPrivateAddresses: null },
    { allowedHosts: [], unexpected: true }, { allowedHosts: [null] },
    { allowedHosts: ["https://user:secret-canary@host"] },
  ])("rejects invalid object-only entries: %j", (entry) => {
    expect(() => resolveVendorDestinationPolicy("freeman", required, known,
      JSON.stringify({ optional: entry }))).toThrow(WcEndpointPolicyError);
  });

  it.each([undefined, false, true])("shares the effective private flag with presentation: %s", (flag) => {
    const raw = JSON.stringify({ freeman: { allowedHosts: ["*.freeman.com"], allowPrivateAddresses: flag } });
    vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", raw);
    try {
      expect(resolveVendorDestinationPolicy("freeman", required, known)).toMatchObject({
        allowedHosts: ["*.freeman.com"], allowPrivateAddresses: flag === true,
      });
      expect(describeVendorDestinationPolicy({
        id: "freeman", service: "Freeman", httpTransport: "webclient", endpointPolicy: required,
      }, known)).toMatchObject({ allowPrivateAddresses: flag === true, transport: "guarded-http" });
      expect(resolveVendorDestinationPolicy("optional", undefined, known)).toMatchObject({
        allowedHosts: undefined, allowPrivateAddresses: false,
      });
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([
    { raw: "{}", declaration: required, selection: "manifest", status: "restricted" },
    { raw: '{"freeman":{"allowedHosts":["API.OTHER.COM."]}}', declaration: required, selection: "replacement", status: "restricted" },
    { raw: '{"freeman":{"allowedHosts":[]}}', declaration: required, selection: "replacement", status: "deny-all" },
    { raw: "{}", declaration: undefined, selection: "none", status: "unrestricted" },
    { raw: '{"disabled":{"allowedHosts":[]}}', declaration: required, selection: "manifest", status: "restricted" },
  ])("describes exactly the runtime policy: $selection / $status ($raw)", ({ raw, declaration, selection, status }) => {
    vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", raw);
    try {
      const view = describeVendorDestinationPolicy({
        id: "freeman", service: "Freeman", httpTransport: "webclient",
        endpointPolicy: declaration,
      }, known);
      expect(view).toMatchObject({
        pluginId: "freeman", selection, status, transport: "guarded-http",
        effectivePatterns: resolveVendorAllowedHosts("freeman", declaration, known) ?? null,
        configurationSource: "environment", deploymentLocked: true,
        requiresAllowlist: declaration?.requiresAllowlist === true,
        allowPrivateAddresses: false,
      });
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(["{", '{"typo-with-secret-canary":[]}', '{"optional":["https://user:secret-canary@host"]}'])(
    "reports invalid policy without relaying malformed contents: %s", (raw) => {
      vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", raw);
      try {
        const view = describeVendorDestinationPolicy({ id: "freeman", endpointPolicy: required }, known);
        expect(view).toMatchObject({ status: "invalid", selection: "invalid", effectivePatterns: null });
        expect(JSON.stringify(view)).not.toContain("secret-canary");
        expect(() => resolveVendorAllowedHosts("freeman", required, known)).toThrow(WcEndpointPolicyError);
      } finally { vi.unstubAllEnvs(); }
    },
  );

  it("reports a missing required policy as invalid, not unrestricted", () => {
    vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", "{}");
    try {
      expect(describeVendorDestinationPolicy({
        id: "freeman", endpointPolicy: { requiresAllowlist: true },
      }, known)).toMatchObject({ status: "invalid", effectivePatterns: null });
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(["", "__UNSET__"])("shows whole-map deployment lock and released in-app precedence: %s", (released) => {
    setEnvironmentVariableOverrideSource(() => '{"freeman":{"allowedHosts":[]}}');
    try {
      vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", "{}");
      const plugin = { id: "freeman", endpointPolicy: required };
      expect(describeVendorDestinationPolicy(plugin, known)).toMatchObject({
        selection: "manifest", deploymentLocked: true, configurationSource: "environment",
      });
      vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", released);
      expect(describeVendorDestinationPolicy(plugin, known)).toMatchObject({
        selection: "replacement", status: "deny-all",
        deploymentLocked: false, configurationSource: "override",
        effectivePatterns: resolveVendorAllowedHosts("freeman", required, known),
      });
      setEnvironmentVariableOverrideSource(null);
      expect(describeVendorDestinationPolicy(plugin, known)).toMatchObject({
        selection: "manifest", deploymentLocked: false, configurationSource: null,
      });
    } finally {
      setEnvironmentVariableOverrideSource(null);
      vi.unstubAllEnvs();
    }
  });

  it.each(["{}", '{"optional":{"allowedHosts":[]}}', '{"optional":{"allowedHosts":["api.example.com"],"allowPrivateAddresses":true}}'])(
    "reports unadapted browser/SDK support using the invocation guard: %s", (raw) => {
      vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", raw);
      try {
        const plugin = { id: "optional", service: "Browser" };
        const view = describeVendorDestinationPolicy(plugin, known);
        const allowed = resolveVendorDestinationPolicy(plugin.id, undefined, known);
        if (view.transport === "unsupported") {
          expect(() => assertVendorDestinationTransport(plugin.id, true, undefined, allowed))
            .toThrow(WcEndpointPolicyError);
        } else {
          expect(view.transport).toBe("unguarded");
          expect(() => assertVendorDestinationTransport(plugin.id, true, undefined, allowed)).not.toThrow();
        }
        expect(describeVendorDestinationPolicy({ id: "optional" }, known).transport).toBe("local");
      } finally { vi.unstubAllEnvs(); }
    },
  );

  it("uses defaults, replacements, explicit empty lists and optional policies", () => {
    expect(resolveVendorAllowedHosts("freeman", required, known, "{}")).toEqual(["*.freeman.com"]);
    expect(resolveVendorAllowedHosts("freeman", required, known, '{"freeman":{"allowedHosts":["api.other.com"]}}')).toEqual(["api.other.com"]);
    expect(resolveVendorAllowedHosts("freeman", required, known, '{"freeman":{"allowedHosts":[]}}')).toEqual([]);
    expect(resolveVendorAllowedHosts("optional", undefined, known, "{}")).toBeUndefined();
    expect(resolveVendorAllowedHosts("optional", undefined, known, '{"optional":{"allowedHosts":["api.other.com"]}}')).toEqual(["api.other.com"]);
    expect(() => resolveVendorAllowedHosts("freeman", { requiresAllowlist: true }, known, "{}")).toThrow(WcEndpointPolicyError);
    expect(resolveVendorAllowedHosts("freeman", required, known, '{"disabled":{"allowedHosts":[]}}')).toEqual(["*.freeman.com"]);
  });

  it.each(["null", "[]", "{", '{"typo":[]}', '{"freeman":null}', '{"optional":["https://evil.com"]}'])(
    "fails closed for malformed maps or any malformed entry: %s", (raw) => {
      expect(() => resolveVendorAllowedHosts("freeman", required, known, raw)).toThrow(WcEndpointPolicyError);
    },
  );

  it("matches canonical exact hosts and true subdomains only", () => {
    expect(normalizeHostPattern("*.FREEMAN.COM.", "freeman")).toBe("*.freeman.com");
    expect(hostMatches("a.b.freeman.com", ["*.freeman.com"])).toBe(true);
    expect(hostMatches("freeman.com", ["*.freeman.com"])).toBe(false);
    expect(hostMatches("evilfreeman.com", ["*.freeman.com"])).toBe(false);
    expect(hostMatches("freeman.com.evil.com", ["*.freeman.com"])).toBe(false);
    expect(hostMatches("API.FREEMAN.COM.", ["api.freeman.com"])).toBe(true);
    expect(hostMatches("x.api.freeman.com", ["api.freeman.com"])).toBe(false);
  });

  it.each(["*", "foo.*.com", "https://freeman.com", "freeman.com:443", "user@freeman.com", " freeman.com", "freeman.com/path", "freeman%2ecom"])(
    "rejects malformed patterns: %s", (pattern) => {
      expect(() => normalizeHostPattern(pattern, "freeman")).toThrow(WcEndpointPolicyError);
    },
  );

  it("retains the registry's deployment-before-override precedence", () => {
    vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", '{"freeman":{"allowedHosts":["deployment.freeman.com"]}}');
    setEnvironmentVariableOverrideSource(() => '{"freeman":{"allowedHosts":["api.freeman.com"]}}');
    try {
      expect(resolveVendorAllowedHosts("freeman", required, known)).toEqual(["deployment.freeman.com"]);
      vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", "");
      expect(resolveVendorAllowedHosts("freeman", required, known)).toEqual(["api.freeman.com"]);
      setEnvironmentVariableOverride("WEBCLIENT_VENDOR_ALLOWED_HOSTS", () => '{"freeman":{"allowedHosts":[]}}');
      expect(resolveVendorAllowedHosts("freeman", required, known)).toEqual([]);
    } finally {
      setEnvironmentVariableOverride("WEBCLIENT_VENDOR_ALLOWED_HOSTS", null);
      setEnvironmentVariableOverrideSource(null);
      vi.unstubAllEnvs();
    }
  });
});

describe("socket destination safety", () => {
  it.each(["10.248.12.15", "172.16.1.2", "192.168.1.2", "fc00::1", "fd12:3456::1"])(
    "allows ordinary private DNS answers only with opt-in: %s", async (address) => {
      for (const enabled of [false, true]) {
        const answers = [{ address: "8.8.8.8", family: 4 },
          { address, family: address.includes(":") ? 6 : 4 }];
        const lookup = publicVendorLookup("optional", async () => answers, enabled);
        await new Promise<void>((resolve) => lookup("api.example.com", { all: true }, (error, checked) => {
          expect(Boolean(error)).toBe(!enabled);
          if (enabled) expect(checked).toEqual(answers);
          resolve();
        }));
      }
    },
  );
  it.each(["0.0.0.0", "127.0.0.1", "100.100.100.200", "169.254.169.254",
    "168.63.129.16", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:10.1.2.3", "::ffff:8.8.8.8", "fe80::1",
    "ff02::1", "64:ff9b::a00:1", "2002:a00:1::", "2001:db8::1", "fd00:ec2::254", "fd20:ce::254"])(
    "private opt-in never permits special destinations: %s", async (address) => {
      const lookup = publicVendorLookup("optional", async () => [
        { address: "10.248.12.15", family: 4 },
        { address, family: address.includes(":") ? 6 : 4 },
      ], true);
      await new Promise<void>((resolve) => lookup("api.example.com", {}, (error) => {
        expect(error).toBeInstanceOf(WcEndpointPolicyError);
        expect(error?.message).toContain("rejected 1/2");
        resolve();
      }));
    },
  );
  it("retains hostname and deny-all restrictions with private access", () => {
    for (const hosts of [[], ["other.example.com"]]) {
      expect(() => validateVendorUrl("optional", "https://api.example.com", policy(hosts, true)))
        .toThrow(WcEndpointPolicyError);
    }
    expect(validateVendorUrl("optional", "https://10.1.2.3", policy(["10.1.2.3"], true)).hostname)
      .toBe("10.1.2.3");
    expect(() => validateVendorUrl("optional", "https://10.1.2.3", policy(["10.1.2.3"])))
      .toThrow(WcEndpointPolicyError);
    expect(() => validateVendorUrl("optional", "https://[fd00:ec2::254]", policy(undefined, true)))
      .toThrow(WcEndpointPolicyError);
  });
  it.each(["8.8.8.8", "99.86.101.78", "1.1.1.1", "2606:4700:4700::1111"])(
    "permits a public address: %s", (address) => expect(isPublicVendorAddress(address)).toBe(true),
  );
  it.each(["0.0.0.0", "127.0.0.1", "10.1.2.3", "100.100.100.200", "169.254.169.254",
    "172.16.0.1", "192.168.0.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fc00::1", "fe80::1",
    "ff02::1", "64:ff9b::a00:1", "2002:a00:1::", "2001:db8::1"])(
    "refuses a non-public/special address: %s", (address) => expect(isPublicVendorAddress(address)).toBe(false),
  );
  it.each(["http://api.freeman.com", "https://api.freeman.com:8443", "https://user:secret@api.freeman.com",
    "https://api.freeman.com.evil.com", "https://127.1", "https://2130706433", "https://[::1]"])(
    "refuses unsafe URLs without disclosing credentials: %s", (input) => {
      expect(() => validateVendorUrl("freeman", input, policy(["*.freeman.com"]))).toThrow(WcEndpointPolicyError);
      try { validateVendorUrl("freeman", input, policy(["*.freeman.com"])); } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    },
  );
  it("blocks an empty list even for a public URL", () => {
    expect(() => validateVendorUrl("optional", "https://example.com", policy([]))).toThrow(WcEndpointPolicyError);
    expect(validateVendorUrl("optional", "https://example.com", policy(undefined)).hostname).toBe("example.com");
  });
  it("checks every DNS answer and hands only checked results to the socket", async () => {
    const publicAnswers = [
      { address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 },
    ];
    const lookup = publicVendorLookup("freeman", async () => publicAnswers);
    await new Promise<void>((resolve, reject) => lookup("api.freeman.com", { all: true }, (error, answers) => {
      if (error) return reject(error);
      expect(answers).toEqual(publicAnswers);
      resolve();
    }));
    await new Promise<void>((resolve, reject) => lookup("api.freeman.com", {}, (error, address, family) => {
      if (error) return reject(error);
      expect(address).toBe("8.8.8.8");
      expect(family).toBe(4);
      resolve();
    }));
    const mixed = publicVendorLookup("freeman", async () => [
      { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 },
    ]);
    await new Promise<void>((resolve) => mixed("api.freeman.com", {}, (error) => {
      expect(error).toBeInstanceOf(WcEndpointPolicyError);
      expect(error?.message).toContain("rejected 1/2 answers [127.0.0.1: loopback (127.0.0.0/8)]");
      resolve();
    }));
  });
  it.each([
    ["10.1.2.3", "private (10.0.0.0/8)"],
    ["169.254.169.254", "link-local/metadata"],
    ["::ffff:8.8.8.8", "IPv4-mapped IPv6"],
    ["fc00::1", "outside global IPv6 unicast"],
    ["2001:db8::1", "documentation"],
  ])("identifies the rejected DNS address and reason: %s", async (address, reason) => {
    const lookup = publicVendorLookup("freeman", async () => [{ address, family: address.includes(":") ? 6 : 4 }]);
    await new Promise<void>((resolve) => lookup("dev.api.freeman.com", {}, (error) => {
      expect(error?.message).toContain(address);
      expect(error?.message).toContain(reason);
      resolve();
    }));
  });
  it("does not include an IPv6 scope identifier in diagnostics", async () => {
    const lookup = publicVendorLookup("freeman", async () => [{ address: "fe80::1%secret-canary", family: 6 }]);
    await new Promise<void>((resolve) => lookup("dev.api.freeman.com", {}, (error) => {
      expect(error?.message).toContain("fe80::1: outside global IPv6 unicast");
      expect(error?.message).not.toContain("canary");
      resolve();
    }));
  });
  it("bounds DNS details and never relays invalid answers or native error messages", async () => {
    const lookup = publicVendorLookup("freeman", async () => [
      { address: "secret-canary\nhttps://user:token@host", family: 4 },
      ...Array.from({ length: 40 }, () => ({ address: "127.0.0.1", family: 4 })),
    ]);
    await new Promise<void>((resolve) => lookup("dev.api.freeman.com", {}, (error) => {
      expect(error?.message).toContain("rejected 41/41 answers");
      expect(error?.message).toContain("[invalid address]: invalid IP address");
      expect(error?.message).toContain("33 more rejected answers omitted");
      expect(error?.message).not.toContain("canary");
      expect(error!.message.length).toBeLessThan(1000);
      resolve();
    }));
    for (const code of ["ENOTFOUND", "EAI_AGAIN", "secret-canary"]) {
      const failed = publicVendorLookup("freeman", async () => {
        throw Object.assign(new Error("https://user:secret-canary@host"), { code });
      });
      await new Promise<void>((resolve) => failed("dev.api.freeman.com", {}, (error) => {
        expect(error?.message).toContain("DNS resolution failed");
        expect(error?.message).not.toContain("canary");
        expect(error?.message).not.toContain("rejected");
        if (code !== "secret-canary") expect(error?.message).toContain(code);
        resolve();
      }));
    }
  });
  it("distinguishes no DNS answers from a resolver failure", async () => {
    const lookup = publicVendorLookup("freeman", async () => []);
    await new Promise<void>((resolve) => lookup("dev.api.freeman.com", {}, (error) => {
      expect(error?.message).toContain("no address answers");
      expect(error?.message).not.toContain("DNS resolution failed");
      resolve();
    }));
  });
  it("resolves again on each socket attempt, preventing a rebound private connection", async () => {
    let calls = 0;
    const lookup = publicVendorLookup("freeman", async () =>
      [{ address: calls++ === 0 ? "8.8.8.8" : "169.254.169.254", family: 4 }]);
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise<void>((resolve) => lookup("api.freeman.com", {}, (error) => {
        expect(Boolean(error)).toBe(attempt === 1);
        resolve();
      }));
    }
  });
  it("remembers refusals even when a plugin catches the error; rereads live policies", async () => {
    let hosts = ["api.freeman.com"];
    const http = createVendorHttp("freeman", () => policy(hosts));
    hosts = [];
    await expect(http.fetch("https://api.freeman.com/private?token=canary")).rejects.toThrow(WcEndpointPolicyError);
    expect(() => http.throwIfRefused()).toThrow(WcEndpointPolicyError);
    try { http.throwIfRefused(); } catch (error) { expect(String(error)).not.toContain("canary"); }
  });
});
