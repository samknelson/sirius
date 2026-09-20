import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";
import {
  deleteLegacyCommServiceConfigs,
  validateLegacyCommConfigCleanup,
  type CommVendorConfigCandidate,
} from "../../scripts/migrate/helpers/comm-service-config-cleanup";

const noEnvironment = {
  getValue: () => undefined,
  isSecretPresent: () => false,
};

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
          name text,
          ordering integer NOT NULL DEFAULT 0,
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

      expect(await deleteLegacyCommServiceConfigs(tx, noEnvironment)).toBe(3);
      const remaining = await tx.execute(sql`
        SELECT name FROM variables WHERE name LIKE 'service_config:%'
      `);
      expect(remaining.rows).toEqual([]);
      expect(await deleteLegacyCommServiceConfigs(tx, noEnvironment)).toBe(0);
    });
  });

  it("creates a missing postal selection while preserving existing SMS and email selections", async () => {
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

      expect(await deleteLegacyCommServiceConfigs(tx, noEnvironment)).toBe(3);
      const remaining = await tx.execute(sql`
        SELECT name FROM variables WHERE name LIKE 'service_config:%' ORDER BY name
      `);
      expect(remaining.rows).toHaveLength(0);
      const postal = await tx.execute(sql`
        SELECT plugin_id, enabled FROM plugin_configs
        WHERE plugin_id = 'local-postal'
      `);
      expect(postal.rows).toEqual([{ plugin_id: "local-postal", enabled: true }]);
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

      expect(await deleteLegacyCommServiceConfigs(tx, noEnvironment)).toBe(1);
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
      const deleted = await deleteLegacyCommServiceConfigs(tx, {
        getValue: () => undefined,
        isSecretPresent: (name) => {
          checked.push(name);
          return name === "CUSTOM_SENDGRID_SECRET";
        },
      });

      expect(deleted).toBe(1);
      expect(checked).toEqual(["CUSTOM_SENDGRID_SECRET"]);
    });
  });

  it("repairs the production-shaped missing SMS selection from legacy Twilio settings", async () => {
    await withFixture(async (tx) => {
      const sentinel = "must-not-be-copied";
      await tx.execute(sql`
        INSERT INTO variables (name, value) VALUES (
          'service_config:sms',
          ${JSON.stringify({
            defaultProvider: "twilio",
            providers: {
              twilio: {
                settings: {
                  account_sid: "AClegacy",
                  defaultPhoneNumber: "+15555550100",
                  authToken: sentinel,
                },
              },
            },
          })}::jsonb
        )
      `);

      expect(
        await deleteLegacyCommServiceConfigs(tx, {
          getValue: () => undefined,
          isSecretPresent: (name) => name === "TWILIO_AUTH_TOKEN",
        }),
      ).toBe(1);
      const configs = await tx.execute(sql`
        SELECT plugin_id, enabled, data FROM plugin_configs
      `);
      expect(configs.rows).toEqual(expect.arrayContaining([
        {
          plugin_id: "twilio",
          enabled: true,
          data: {
            accountSid: "AClegacy",
            fromNumber: "+15555550100",
            secretName: "TWILIO_AUTH_TOKEN",
          },
        },
        { plugin_id: "sms-local", enabled: false, data: {} },
      ]));
      expect(JSON.stringify(configs.rows)).not.toContain(sentinel);
    });
  });

  it("uses a complete environment Twilio configuration before Local", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO variables (name, value)
        VALUES ('service_config:sms', '{}'::jsonb)
      `);
      const values: Record<string, string> = {
        TWILIO_ACCOUNT_SID: "ACenvironment",
        TWILIO_PHONE_NUMBER: "+15555550101",
      };
      expect(
        await deleteLegacyCommServiceConfigs(tx, {
          getValue: (name) => values[name],
          isSecretPresent: (name) => name === "TWILIO_AUTH_TOKEN",
        }),
      ).toBe(1);
      const configs = await tx.execute(sql`
        SELECT plugin_id, data FROM plugin_configs
      `);
      expect(configs.rows).toEqual(expect.arrayContaining([
        {
          plugin_id: "twilio",
          data: {
            accountSid: "ACenvironment",
            fromNumber: "+15555550101",
            secretName: "TWILIO_AUTH_TOKEN",
          },
        },
        { plugin_id: "sms-local", data: {} },
      ]));
    });
  });

  it("uses DB-backed non-secret Twilio settings with a DB-backed credential", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO variables (name, value) VALUES
          ('service_config:sms', '{}'::jsonb),
          ('ENV_TWILIO_ACCOUNT_SID', '"ACstored"'::jsonb),
          ('ENV_TWILIO_PHONE_NUMBER', '"+15555550102"'::jsonb),
          ('ENV_TWILIO_AUTH_TOKEN', '"credential-not-read"'::jsonb)
      `);

      expect(await deleteLegacyCommServiceConfigs(tx, noEnvironment)).toBe(1);
      const configs = await tx.execute(sql`
        SELECT plugin_id, data FROM plugin_configs
      `);
      expect(configs.rows).toEqual(expect.arrayContaining([
        {
          plugin_id: "twilio",
          data: {
            accountSid: "ACstored",
            fromNumber: "+15555550102",
            secretName: "TWILIO_AUTH_TOKEN",
          },
        },
        { plugin_id: "sms-local", data: {} },
      ]));
      expect(JSON.stringify(configs.rows)).not.toContain("credential-not-read");
    });
  });

  it("uses DB-backed remote credentials when choosing email and postal providers", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO variables (name, value) VALUES
          ('service_config:email', '{}'::jsonb),
          ('service_config:postal', '{}'::jsonb),
          ('ENV_SENDGRID_API_KEY', '"stored-email-secret"'::jsonb),
          ('ENV_LOB_API_KEY', '"stored-postal-secret"'::jsonb)
      `);

      expect(await deleteLegacyCommServiceConfigs(tx, noEnvironment)).toBe(2);
      const configs = await tx.execute(sql`
        SELECT plugin_id, data FROM plugin_configs ORDER BY plugin_id
      `);
      expect(configs.rows).toEqual([
        { plugin_id: "lob", data: { secretName: "LOB_API_KEY" } },
        { plugin_id: "sendgrid", data: { secretName: "SENDGRID_API_KEY" } },
      ]);
    });
  });

  it("fails the owning transaction when a selected remote credential is unavailable", async () => {
    await expect(
      withFixture(async (tx) => {
        await tx.execute(sql`
          INSERT INTO variables (name, value)
          VALUES (
            'service_config:email',
            '{"defaultProvider":"sendgrid"}'::jsonb
          )
        `);
        await deleteLegacyCommServiceConfigs(tx, noEnvironment);
      }),
    ).rejects.toThrow(/named secret/i);
  });

  it("repairs and scrubs an enabled Twilio row before cleanup", async () => {
    await withFixture(async (tx) => {
      const sentinel = "raw-token-must-disappear";
      await tx.execute(sql`
        INSERT INTO variables (name, value) VALUES (
          'service_config:sms',
          '{"defaultProvider":"twilio","providers":{"twilio":{"settings":{"accountSid":"AClegacy","fromNumber":"+15555550103"}}}}'::jsonb
        )
      `);
      await tx.execute(sql`
        INSERT INTO plugin_configs (
          id, plugin_kind, plugin_id, enabled, data
        ) VALUES (
          'twilio-existing', 'wc-vendors', 'twilio', true,
          ${JSON.stringify({ authToken: sentinel })}::jsonb
        )
      `);

      expect(
        await deleteLegacyCommServiceConfigs(tx, {
          getValue: () => undefined,
          isSecretPresent: (name) => name === "TWILIO_AUTH_TOKEN",
        }),
      ).toBe(1);
      const configs = await tx.execute(sql`
        SELECT data FROM plugin_configs WHERE id = 'twilio-existing'
      `);
      expect(configs.rows).toEqual([{
        data: {
          accountSid: "AClegacy",
          fromNumber: "+15555550103",
          secretName: "TWILIO_AUTH_TOKEN",
        },
      }]);
      expect(JSON.stringify(configs.rows)).not.toContain(sentinel);
    });
  });

  it("refuses to guess between disabled SMS rows", async () => {
    await expect(
      withFixture(async (tx) => {
        await tx.execute(sql`
          INSERT INTO variables (name, value)
          VALUES ('service_config:sms', '{"defaultProvider":"twilio"}'::jsonb)
        `);
        await tx.execute(sql`
          INSERT INTO plugin_configs (
            id, plugin_kind, plugin_id, enabled, data
          ) VALUES
            ('twilio-disabled', 'wc-vendors', 'twilio', false, '{}'),
            ('local-disabled', 'wc-vendors', 'sms-local', false, '{}')
        `);
        await deleteLegacyCommServiceConfigs(tx, noEnvironment);
      }),
    ).rejects.toThrow(/single enabled/i);
  });

  it("enables the sole disabled postal row when no legacy or environment preference exists", async () => {
    await withFixture(async (tx) => {
      await tx.execute(sql`
        INSERT INTO variables (name, value)
        VALUES ('service_config:postal', '{}'::jsonb)
      `);
      await tx.execute(sql`
        INSERT INTO plugin_configs (
          id, plugin_kind, plugin_id, enabled, data
        ) VALUES (
          'lob-disabled', 'wc-vendors', 'lob', false,
          '{"secretName":"LOB_API_KEY"}'::jsonb
        )
      `);

      expect(
        await deleteLegacyCommServiceConfigs(tx, {
          getValue: () => undefined,
          isSecretPresent: (name) => name === "LOB_API_KEY",
        }),
      ).toBe(1);
      const configs = await tx.execute(sql`
        SELECT plugin_id, enabled FROM plugin_configs
      `);
      expect(configs.rows).toEqual([{ plugin_id: "lob", enabled: true }]);
    });
  });
});