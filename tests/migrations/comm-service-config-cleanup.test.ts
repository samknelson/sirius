import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";
import {
  deleteLegacyCommServiceConfigs,
  validateLegacyCommConfigCleanup,
  type CommVendorConfigCandidate,
} from "../../scripts/migrate/helpers/comm-service-config-cleanup";

const config = (
  id: string,
  pluginId: string,
  data: Record<string, unknown> = {},
): CommVendorConfigCandidate => ({ id, pluginId, data });

const remoteConfigs = [
  config("sms", "twilio", {
    accountSid: "ACsafe-account-id",
    fromNumber: "+15555550100",
    secretName: "TWILIO_AUTH_TOKEN",
  }),
  config("email", "sendgrid", { secretName: "SENDGRID_API_KEY" }),
  config("postal", "lob", { secretName: "LOB_API_KEY" }),
];

describe("legacy communication setting cleanup", () => {
  it("accepts usable remote selections without inspecting credential values", () => {
    expect(
      validateLegacyCommConfigCleanup(
        [
          "service_config:sms",
          "service_config:email",
          "service_config:postal",
        ],
        remoteConfigs,
      ),
    ).toEqual([
      "service_config:sms",
      "service_config:email",
      "service_config:postal",
    ]);
  });

  it("normalizes Twilio configuration before format validation", () => {
    expect(
      validateLegacyCommConfigCleanup(
        ["service_config:sms"],
        [
          config("sms", "twilio", {
            accountSid: "  ACsafe-account-id  ",
            fromNumber: "  +15555550100  ",
            secretName: "TWILIO_AUTH_TOKEN",
          }),
        ],
      ),
    ).toEqual(["service_config:sms"]);
  });

  it("accepts local selections and the compatibility local-email id", () => {
    expect(
      validateLegacyCommConfigCleanup(
        [
          "service_config:sms",
          "service_config:email",
          "service_config:postal",
        ],
        [
          config("sms", "sms-local"),
          config("email", "local"),
          config("postal", "local-postal"),
        ],
      ),
    ).toHaveLength(3);
  });

  it("is a no-op when the database is already clean", () => {
    expect(validateLegacyCommConfigCleanup([], [])).toEqual([]);
  });

  it("validates only media whose legacy rows still exist", () => {
    expect(
      validateLegacyCommConfigCleanup(
        ["service_config:email"],
        [config("email", "local-email")],
      ),
    ).toEqual(["service_config:email"]);
  });

  it("refuses a missing canonical selection", () => {
    expect(() =>
      validateLegacyCommConfigCleanup(["service_config:sms"], []),
    ).toThrow(/no enabled canonical/i);
  });

  it("refuses an ambiguous canonical selection", () => {
    expect(() =>
      validateLegacyCommConfigCleanup(
        ["service_config:postal"],
        [config("one", "lob", { secretName: "LOB_API_KEY" }), config("two", "local-postal")],
      ),
    ).toThrow(/multiple enabled canonical/i);
  });

  it.each([
    ["sms", "service_config:sms", config("sms", "twilio", { secretName: "TWILIO_AUTH_TOKEN" })],
    ["email", "service_config:email", config("email", "sendgrid")],
    ["postal", "service_config:postal", config("postal", "lob")],
  ])("refuses incomplete remote %s configuration", (_medium, legacyName, candidate) => {
    expect(() =>
      validateLegacyCommConfigCleanup([legacyName], [candidate]),
    ).toThrow(/incomplete/i);
  });

  it("does not include configuration data in refusal messages", () => {
    const sentinel = "credential-value-must-not-leak";
    expect(() =>
      validateLegacyCommConfigCleanup(
        ["service_config:email"],
        [config("email", "sendgrid", { apiKey: sentinel })],
      ),
    ).toThrowError(expect.not.stringContaining(sentinel));
  });
});

describe.sequential("legacy communication setting cleanup transaction", () => {
  async function withFixture(
    callback: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE variables (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL UNIQUE,
          value jsonb NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE plugin_configs (
          id varchar PRIMARY KEY,
          plugin_kind varchar NOT NULL,
          plugin_id text NOT NULL,
          enabled boolean NOT NULL,
          data jsonb
        ) ON COMMIT DROP
      `);
      await callback(tx);
    });
  }

  it("deletes valid local legacy rows without requiring subsidiary history", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO variables (name, value) VALUES
          ('service_config:sms', '{"old":"sms"}'::jsonb),
          ('service_config:email', '{"old":"email"}'::jsonb),
          ('service_config:postal', '{"old":"postal"}'::jsonb)
      `);
      await tx.execute(sql`
        INSERT INTO plugin_configs (id, plugin_kind, plugin_id, enabled, data) VALUES
          ('sms', 'wc-vendors', 'sms-local', true, '{}'),
          ('email', 'wc-vendors', 'local-email', true, '{}'),
          ('postal', 'wc-vendors', 'local-postal', true, '{}')
      `);

      expect(await deleteLegacyCommServiceConfigs(tx, () => false)).toBe(3);
      const remaining = await tx.execute(sql`
        SELECT name FROM variables WHERE name LIKE 'service_config:%'
      `);
      expect(remaining.rows).toEqual([]);
      expect(await deleteLegacyCommServiceConfigs(tx, () => false)).toBe(0);
    });
  });

  it("keeps every legacy row when one canonical selection is missing", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO variables (name, value) VALUES
          ('service_config:sms', '{"old":"sms"}'::jsonb),
          ('service_config:email', '{"old":"email"}'::jsonb),
          ('service_config:postal', '{"old":"postal"}'::jsonb)
      `);
      await tx.execute(sql`
        INSERT INTO plugin_configs (id, plugin_kind, plugin_id, enabled, data) VALUES
          ('sms', 'wc-vendors', 'sms-local', true, '{}'),
          ('email', 'wc-vendors', 'local-email', true, '{}')
      `);

      await expect(
        deleteLegacyCommServiceConfigs(tx, () => false),
      ).rejects.toThrow(/service_config:postal/);
      const remaining = await tx.execute(sql`
        SELECT name FROM variables WHERE name LIKE 'service_config:%' ORDER BY name
      `);
      expect(remaining.rows).toHaveLength(3);
    });
  });

  it("accepts a DB-backed named secret without copying or deleting it", async () => {
    await withFixture(async (tx) => {
      const sentinel = "credential-value-must-remain-only-in-env-row";
      await tx.execute(sql`
        INSERT INTO variables (name, value) VALUES
          ('service_config:email', '{"old":"email"}'::jsonb),
          ('ENV_SENDGRID_API_KEY', ${JSON.stringify(sentinel)}::jsonb)
      `);
      await tx.execute(sql`
        INSERT INTO plugin_configs (id, plugin_kind, plugin_id, enabled, data)
        VALUES (
          'email',
          'wc-vendors',
          'sendgrid',
          true,
          '{"secretName":"SENDGRID_API_KEY"}'::jsonb
        )
      `);

      expect(await deleteLegacyCommServiceConfigs(tx, () => false)).toBe(1);
      const remaining = await tx.execute(sql`
        SELECT name, value FROM variables ORDER BY name
      `);
      expect(remaining.rows).toEqual([
        { name: "ENV_SENDGRID_API_KEY", value: sentinel },
      ]);
    });
  });

  it("accepts a process-backed custom secret name through the runtime presence contract", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO variables (name, value)
        VALUES ('service_config:email', '{"old":"email"}'::jsonb)
      `);
      await tx.execute(sql`
        INSERT INTO plugin_configs (id, plugin_kind, plugin_id, enabled, data)
        VALUES (
          'email',
          'wc-vendors',
          'sendgrid',
          true,
          '{"secretName":"CUSTOM_SENDGRID_SECRET"}'::jsonb
        )
      `);
      const checked: string[] = [];
      const deleted = await deleteLegacyCommServiceConfigs(tx, (name) => {
        checked.push(name);
        return name === "CUSTOM_SENDGRID_SECRET";
      });

      expect(deleted).toBe(1);
      expect(checked).toEqual(["CUSTOM_SENDGRID_SECRET"]);
    });
  });
});