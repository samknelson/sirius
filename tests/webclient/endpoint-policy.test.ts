import { describe, expect, it, vi } from "vitest";
import {
  hostMatches, normalizeHostPattern, resolveVendorAllowedHosts,
} from "../../server/services/webclient/endpoint-policy";
import {
  createVendorHttp, isPublicVendorAddress, publicVendorLookup, validateVendorUrl,
} from "../../server/services/webclient/vendor-http";
import { setEnvironmentVariableOverride, setEnvironmentVariableOverrideSource } from "../../server/config/env-registry";
import { WcEndpointPolicyError } from "../../server/services/webclient/refusals";

const known = (id: string) => ["freeman", "optional", "disabled"].includes(id);
const required = { requiresAllowlist: true, defaultAllowedHosts: ["*.freeman.com"] };

describe("vendor destination policy", () => {
  it("uses defaults, replacements, explicit empty lists and optional policies", () => {
    expect(resolveVendorAllowedHosts("freeman", required, known, "{}")).toEqual(["*.freeman.com"]);
    expect(resolveVendorAllowedHosts("freeman", required, known, '{"freeman":["api.other.com"]}')).toEqual(["api.other.com"]);
    expect(resolveVendorAllowedHosts("freeman", required, known, '{"freeman":[]}')).toEqual([]);
    expect(resolveVendorAllowedHosts("optional", undefined, known, "{}")).toBeUndefined();
    expect(resolveVendorAllowedHosts("optional", undefined, known, '{"optional":["api.other.com"]}')).toEqual(["api.other.com"]);
    expect(() => resolveVendorAllowedHosts("freeman", { requiresAllowlist: true }, known, "{}")).toThrow(WcEndpointPolicyError);
    expect(resolveVendorAllowedHosts("freeman", required, known, '{"disabled":[]}')).toEqual(["*.freeman.com"]);
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
    vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", '{"freeman":["deployment.freeman.com"]}');
    setEnvironmentVariableOverrideSource(() => '{"freeman":["api.freeman.com"]}');
    try {
      expect(resolveVendorAllowedHosts("freeman", required, known)).toEqual(["deployment.freeman.com"]);
      vi.stubEnv("WEBCLIENT_VENDOR_ALLOWED_HOSTS", "");
      expect(resolveVendorAllowedHosts("freeman", required, known)).toEqual(["api.freeman.com"]);
      setEnvironmentVariableOverride("WEBCLIENT_VENDOR_ALLOWED_HOSTS", () => '{"freeman":[]}');
      expect(resolveVendorAllowedHosts("freeman", required, known)).toEqual([]);
    } finally {
      setEnvironmentVariableOverride("WEBCLIENT_VENDOR_ALLOWED_HOSTS", null);
      setEnvironmentVariableOverrideSource(null);
      vi.unstubAllEnvs();
    }
  });
});

describe("socket destination safety", () => {
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
      expect(() => validateVendorUrl("freeman", input, ["*.freeman.com"])).toThrow(WcEndpointPolicyError);
      try { validateVendorUrl("freeman", input, ["*.freeman.com"]); } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    },
  );
  it("blocks an empty list even for a public URL", () => {
    expect(() => validateVendorUrl("optional", "https://example.com", [])).toThrow(WcEndpointPolicyError);
    expect(validateVendorUrl("optional", "https://example.com", undefined).hostname).toBe("example.com");
  });
  it("checks every DNS answer and hands only checked results to the socket", async () => {
    const lookup = publicVendorLookup("freeman", async () => [{ address: "8.8.8.8", family: 4 }]);
    await new Promise<void>((resolve, reject) => lookup("api.freeman.com", { all: true }, (error, answers) => {
      if (error) return reject(error);
      expect(answers).toEqual([{ address: "8.8.8.8", family: 4 }]);
      resolve();
    }));
    const mixed = publicVendorLookup("freeman", async () => [
      { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 },
    ]);
    await new Promise<void>((resolve) => mixed("api.freeman.com", {}, (error) => {
      expect(error).toBeInstanceOf(WcEndpointPolicyError);
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
    const http = createVendorHttp("freeman", () => hosts);
    hosts = [];
    await expect(http.fetch("https://api.freeman.com/private?token=canary")).rejects.toThrow(WcEndpointPolicyError);
    expect(() => http.throwIfRefused()).toThrow(WcEndpointPolicyError);
    try { http.throwIfRefused(); } catch (error) { expect(String(error)).not.toContain("canary"); }
  });
});
