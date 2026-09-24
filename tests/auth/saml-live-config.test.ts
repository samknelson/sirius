/**
 * Request-time SAML configuration:
 *   - The SAML provider registers dormant (no vars) and its login handler
 *     redirects to /auth-error?error=saml_not_configured
 *   - EACH missing variable (SAML_ENTRY_POINT, SAML_ISSUER, SAML_CERT)
 *     independently produces the not-configured redirect
 *   - Once all three are present (simulating a Variables-table override
 *     becoming visible to getEnvironmentVariable), the login handler starts a
 *     real SP-initiated flow (redirect to the IdP entry point) WITHOUT any
 *     provider re-setup / restart
 *   - Changing SAML_ENTRY_POINT afterwards rebuilds the strategy: the next
 *     login redirects to the NEW entry point
 *   - Releasing a variable (blank / __UNSET__) makes SAML cleanly
 *     unconfigured again
 */
import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import passport from "passport";
import { createProvider } from "../../server/auth/providers/saml";
import { getRawProcessEnv } from "../../server/config/env-registry";

// Self-signed test cert (structure-valid PEM; never used to verify anything
// in these tests — login only builds an AuthnRequest redirect).
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBszCCAVmgAwIBAgIUTest0000000000000000000000000wCgYIKoZIzj0EAwIw
GjEYMBYGA1UEAwwPdGVzdC5leGFtcGxlLmNvbTAeFw0yNTAxMDEwMDAwMDBaFw0z
NTAxMDEwMDAwMDBaMBoxGDAWBgNVBAMMD3Rlc3QuZXhhbXBsZS5jb20wWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAAT8sampledatasampledatasampledatasample
datasampledatasampledatasampledatasampledataoUMwQTAPBgNVHRMBAf8E
BTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQUsampledatasampledata
MAoGCCqGSM49BAMCA0gAMEUCIQDsampledatasampledatasampledatasample
AiBsampledatasampledatasampledatasampledatasampledata
-----END CERTIFICATE-----`;

const SAML_VARS = [
  "SAML_ENTRY_POINT",
  "SAML_ISSUER",
  "SAML_CERT",
  "SAML_CALLBACK_PATH",
] as const;

function setVars(
  vars: Partial<Record<(typeof SAML_VARS)[number], string>>,
): void {
  // Simulating raw environment values is the point of this test, so it uses
  // the sanctioned whole-environment accessor rather than reading/writing the
  // environment object directly.
  const env = getRawProcessEnv();
  for (const name of SAML_VARS) {
    const v = vars[name];
    if (v === undefined) delete env[name];
    else env[name] = v;
  }
}

/** Run the login handler against fakes; resolve with the redirect URL. */
function runLogin(handler: express.RequestHandler): Promise<string> {
  return new Promise((resolve, reject) => {
    const req: any = {
      query: {},
      path: "/api/auth/saml/login",
      url: "/api/auth/saml/login",
      method: "GET",
      headers: {},
    };
    // Two redirect shapes: our guard uses res.redirect(url); passport's
    // strategy action sets a Location header and calls res.end().
    let location: string | undefined;
    const res: any = {
      redirect(url: string) {
        resolve(url);
      },
      setHeader(name: string, value: string) {
        if (name.toLowerCase() === "location") location = value;
      },
      end() {
        if (location) resolve(location);
        else reject(new Error("response ended without a Location header"));
      },
    };
    const next = (err?: unknown) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else reject(new Error("handler called next() without redirecting"));
    };
    try {
      handler(req, res, next);
    } catch (err) {
      reject(err as Error);
    }
    setTimeout(() => reject(new Error("timed out waiting for redirect")), 5000);
  });
}

const FULL = {
  SAML_ENTRY_POINT: "https://idp-one.example.com/sso/saml",
  SAML_ISSUER: "https://sp.example.com",
  SAML_CERT: TEST_CERT,
};

describe("request-time SAML configuration", () => {
  let provider: Awaited<ReturnType<typeof createProvider>>;

  beforeAll(async () => {
    // Avoid pulling app-wide side effects in: only the storage module the
    // provider itself needs.
    await import("../../server/storage");

    // Start with NO SAML vars: provider must still set up (dormant).
    setVars({});
    const app = express();
    app.use(passport.initialize());
    provider = createProvider({ type: "saml", enabled: true });
    await provider.setup(app);
  });

  it("dormant provider: no vars → saml_not_configured redirect", async () => {
    setVars({});
    const url = await runLogin(provider.getLoginHandler());
    expect(url).toContain("error=saml_not_configured");
  });

  for (const missing of ["SAML_ENTRY_POINT", "SAML_ISSUER", "SAML_CERT"] as const) {
    it(`missing ${missing} alone → saml_not_configured redirect`, async () => {
      const partial: Record<string, string> = { ...FULL };
      delete partial[missing];
      setVars(partial);
      const url = await runLogin(provider.getLoginHandler());
      expect(url).toContain("error=saml_not_configured");
    });
  }

  it("all vars present (post-boot) → redirects to IdP entry point, no restart", async () => {
    setVars(FULL);
    const url = await runLogin(provider.getLoginHandler());
    expect(url.startsWith("https://idp-one.example.com/sso/saml")).toBe(true);
    expect(url).toContain("SAMLRequest=");
  });

  it("changed SAML_ENTRY_POINT → strategy rebuilt, redirects to NEW IdP", async () => {
    setVars({ ...FULL, SAML_ENTRY_POINT: "https://idp-two.example.com/sso/saml" });
    const url = await runLogin(provider.getLoginHandler());
    expect(url.startsWith("https://idp-two.example.com/sso/saml")).toBe(true);
  });

  it("released var (__UNSET__) → cleanly unconfigured again", async () => {
    setVars({ ...FULL, SAML_CERT: "__UNSET__" });
    const url = await runLogin(provider.getLoginHandler());
    expect(url).toContain("error=saml_not_configured");
  });

  it("re-adding the released var → works again without restart", async () => {
    setVars(FULL);
    const url = await runLogin(provider.getLoginHandler());
    expect(url.startsWith("https://idp-one.example.com/sso/saml")).toBe(true);
  });
});
