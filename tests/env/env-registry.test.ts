/**
 * The environment-variable registry and its author-time enforcement rule.
 *
 * The enforcement half shells out to the architecture-lint entry point
 * (`scripts/dev/lint.ts env-registry`) and asserts it both passes on the
 * current tree and catches a planted violation — so the lint rule itself stays
 * honest, not just the registry it guards.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import {
  registerEnvironmentVariable,
  registerEnvironmentVariables,
  isEnvironmentVariableRegistered,
  getEnvironmentVariable,
  setEnvironmentVariable,
  setEnvironmentVariableOverride,
  listEnvironmentVariables,
  listPresentEnvironmentVariableNames,
  getRawProcessEnv,
} from "../../server/config/env-registry";
import { getPublicBaseUrl } from "../../server/services/comm/callback-handlers/url-builder";

/** Invoke a single architecture-lint rule; throws when the rule fails. */
const LINT_ENV_REGISTRY = "npx tsx scripts/dev/lint.ts env-registry";

describe("registry behavior", () => {
  it("core variables are registered at module load", () => {
    expect(isEnvironmentVariableRegistered("DATABASE_URL")).toBe(true);
    expect(isEnvironmentVariableRegistered("NODE_ENV")).toBe(true);
    expect(isEnvironmentVariableRegistered("PUBLIC_URL")).toBe(true);
  });

  it("PUBLIC_URL resolution order: explicit value wins, normalized", () => {
    const env = getRawProcessEnv();
    const saved = {
      PUBLIC_URL: env.PUBLIC_URL,
      REPLIT_DEV_DOMAIN: env.REPLIT_DEV_DOMAIN,
      REPLIT_DEPLOYMENT_DOMAIN: env.REPLIT_DEPLOYMENT_DOMAIN,
      REPLIT_DOMAINS: env.REPLIT_DOMAINS,
    };
    try {
      env.PUBLIC_URL = "https://fls.example.com/";
      env.REPLIT_DEV_DOMAIN = "dev.replit.example";
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "explicit value should win and lose trailing slash",
      ).toBe("https://fls.example.com");

      env.PUBLIC_URL = "fls.example.com";
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "bare host should gain https scheme",
      ).toBe("https://fls.example.com");

      delete env.PUBLIC_URL;
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "should fall back to REPLIT_DEV_DOMAIN",
      ).toBe("https://dev.replit.example");

      delete env.REPLIT_DEV_DOMAIN;
      env.REPLIT_DEPLOYMENT_DOMAIN = "prod.replit.example";
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "should fall back to REPLIT_DEPLOYMENT_DOMAIN",
      ).toBe("https://prod.replit.example");

      delete env.REPLIT_DEPLOYMENT_DOMAIN;
      env.REPLIT_DOMAINS = "a.replit.example,b.replit.example";
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "should fall back to first of REPLIT_DOMAINS",
      ).toBe("https://a.replit.example");

      delete env.REPLIT_DOMAINS;
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "should fall back to localhost last resort",
      ).toBe("https://localhost:5000");

      env.PUBLIC_URL = "http://fls.example.com";
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "http on a non-localhost host should be upgraded to https",
      ).toBe("https://fls.example.com");

      env.PUBLIC_URL = "http://localhost:3000";
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "http should be preserved for localhost",
      ).toBe("http://localhost:3000");

      env.PUBLIC_URL = "https://fls.example.com/some/path?q=1#frag";
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "path, query, and fragment should be stripped to the origin",
      ).toBe("https://fls.example.com");

      env.PUBLIC_URL = "https://";
      expect(() => getEnvironmentVariable("PUBLIC_URL")).toThrow(/cannot be parsed/);

      delete env.PUBLIC_URL;
      env.REPLIT_DEV_DOMAIN = "  dev.replit.example  ";
      expect(
        getEnvironmentVariable("PUBLIC_URL"),
        "platform domain should be trimmed",
      ).toBe("https://dev.replit.example");
      delete env.REPLIT_DEV_DOMAIN;

      // External-callback builder must refuse the localhost fallback.
      expect(
        getPublicBaseUrl(),
        "getPublicBaseUrl should be undefined on the localhost fallback",
      ).toBeUndefined();
      env.PUBLIC_URL = "https://fls.example.com";
      expect(getPublicBaseUrl()).toBe("https://fls.example.com");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
    }
  });

  it("reading an unregistered variable fails loudly", () => {
    expect(() => getEnvironmentVariable("TOTALLY_UNDECLARED_VAR_42")).toThrow(
      /not registered/,
    );
  });

  it("registration + read round-trip", () => {
    registerEnvironmentVariable({
      name: "TEST_ENVREG_PLAIN",
      description: "test variable",
      secret: false,
      category: "core",
    });
    setEnvironmentVariable("TEST_ENVREG_PLAIN", "hello");
    expect(getEnvironmentVariable("TEST_ENVREG_PLAIN")).toBe("hello");
  });

  it("setEnvironmentVariable rejects unregistered names", () => {
    expect(() => setEnvironmentVariable("TEST_ENVREG_UNREG", "x")).toThrow(
      /unregistered/,
    );
  });

  it("secret flag and metadata surface via enumeration (never values)", () => {
    registerEnvironmentVariable({
      name: "TEST_ENVREG_SECRET",
      description: "a secret test variable",
      secret: true,
      category: "sitespecific.t631.client",
    });
    setEnvironmentVariable("TEST_ENVREG_SECRET", "s3cr3t");
    const info = listEnvironmentVariables().find(
      (v) => v.name === "TEST_ENVREG_SECRET",
    );
    expect(info, "enumeration missing TEST_ENVREG_SECRET").toBeTruthy();
    expect(info!.secret, "secret flag lost").toBe(true);
    expect(info!.category, "category lost").toBe("sitespecific.t631.client");
    expect(info!.isSet, "isSet should be true").toBe(true);
    expect(
      JSON.stringify(info).includes("s3cr3t"),
      "enumeration leaked the value",
    ).toBe(false);
  });

  it("declaration transform hook filters values on read", () => {
    registerEnvironmentVariable({
      name: "TEST_ENVREG_TRANSFORM",
      description: "transformed variable",
      secret: false,
      category: "core",
      transform: (v) => (v ?? "default").toUpperCase(),
    });
    setEnvironmentVariable("TEST_ENVREG_TRANSFORM", "abc");
    expect(getEnvironmentVariable("TEST_ENVREG_TRANSFORM")).toBe("ABC");
  });

  it("runtime override applies after transform and can be removed", () => {
    registerEnvironmentVariable({
      name: "TEST_ENVREG_TRANSFORM",
      description: "transformed variable",
      secret: false,
      category: "core",
      transform: (v) => (v ?? "default").toUpperCase(),
    });
    setEnvironmentVariable("TEST_ENVREG_TRANSFORM", "abc");

    setEnvironmentVariableOverride("TEST_ENVREG_TRANSFORM", (v) => `${v}-OVR`);
    expect(getEnvironmentVariable("TEST_ENVREG_TRANSFORM")).toBe("ABC-OVR");
    setEnvironmentVariableOverride("TEST_ENVREG_TRANSFORM", null);
    expect(getEnvironmentVariable("TEST_ENVREG_TRANSFORM")).toBe("ABC");
    expect(() =>
      setEnvironmentVariableOverride("TEST_ENVREG_NOPE", (v) => v),
    ).toThrow(/unregistered/);
  });

  it("required flag throws when unset", () => {
    registerEnvironmentVariable({
      name: "TEST_ENVREG_REQUIRED",
      description: "required variable",
      secret: false,
      category: "core",
      required: true,
    });
    expect(() => getEnvironmentVariable("TEST_ENVREG_REQUIRED")).toThrow(/required/);
    setEnvironmentVariable("TEST_ENVREG_REQUIRED", "present");
    expect(getEnvironmentVariable("TEST_ENVREG_REQUIRED")).toBe("present");
  });

  it("re-registration is idempotent (last declaration wins)", () => {
    registerEnvironmentVariable({
      name: "TEST_ENVREG_PLAIN",
      description: "test variable",
      secret: false,
      category: "core",
    });
    registerEnvironmentVariables([
      {
        name: "TEST_ENVREG_PLAIN",
        description: "updated description",
        secret: true,
        category: "platform",
      },
    ]);
    const info = listEnvironmentVariables().find(
      (v) => v.name === "TEST_ENVREG_PLAIN",
    );
    expect(info!.description, "description not updated").toBe("updated description");
    expect(info!.secret, "secret not updated").toBe(true);
  });

  it("dynamic registration at parse time (FILESYSTEMS-style indirection)", () => {
    const dynamicName = "TEST_ENVREG_DYNAMIC_SECRET";
    // Simulate a config parser encountering a *_secret setting naming an env var.
    registerEnvironmentVariable({
      name: dynamicName,
      description:
        'Secret referenced by FILESYSTEMS filesystem "test" setting "key_secret".',
      secret: true,
      category: "core",
    });
    setEnvironmentVariable(dynamicName, "dyn");
    expect(getEnvironmentVariable(dynamicName)).toBe("dyn");
    const info = listEnvironmentVariables().find((v) => v.name === dynamicName);
    expect(info!.secret, "dynamic registration must be secret").toBe(true);
  });

  it("presence enumeration returns names only", () => {
    registerEnvironmentVariable({
      name: "TEST_ENVREG_PLAIN",
      description: "test variable",
      secret: false,
      category: "core",
    });
    setEnvironmentVariable("TEST_ENVREG_PLAIN", "hello");
    const names = listPresentEnvironmentVariableNames((n) =>
      n.startsWith("TEST_ENVREG_"),
    );
    expect(names, "present name missing").toContain("TEST_ENVREG_PLAIN");
    expect(names.every((n) => typeof n === "string"), "names only").toBe(true);
  });

  it("getRawProcessEnv returns the process environment object", () => {
    registerEnvironmentVariable({
      name: "TEST_ENVREG_PLAIN",
      description: "test variable",
      secret: false,
      category: "core",
    });
    setEnvironmentVariable("TEST_ENVREG_PLAIN", "hello");
    expect(getRawProcessEnv()["TEST_ENVREG_PLAIN"]).toBe("hello");
  });
});

describe("enforcement rule (architecture lint)", () => {
  it("env-registry lint passes on the current working tree", () => {
    expect(() => execSync(LINT_ENV_REGISTRY, { stdio: "pipe" })).not.toThrow();
  });

  it("env-registry lint flags a violating untracked file", () => {
    // Must live inside a scanned prefix; use scripts/oneoffs with a unique name.
    const bad = "scripts/oneoffs/__envreg_check_violation_test.ts";
    writeFileSync(bad, "const x = process.env.SNEAKY_VAR;\nexport default x;\n");
    try {
      let failed = false;
      let output = "";
      try {
        execSync(LINT_ENV_REGISTRY, { stdio: "pipe" });
      } catch (err: any) {
        failed = true;
        output = String(err.stdout) + String(err.stderr);
      }
      expect(failed, "lint should have failed").toBe(true);
      expect(output, "violation file not reported").toContain(bad);
    } finally {
      rmSync(bad, { force: true });
    }
  });

  it("env-registry lint ignores the exempt cjs helper", () => {
    // scripts/post-merge-db-push.cjs contains the forbidden pattern but is
    // exempt; the "passes on current tree" test above already proves this
    // holds, so just sanity-check the file still contains the passthrough.
    const content = execSync("cat scripts/post-merge-db-push.cjs", {
      encoding: "utf8",
    });
    expect(content, "exempt file no longer uses the raw environment").toContain(
      "process" + ".env",
    );
  });
});
