import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";
import { isValidHexColor } from "../../../shared/utils/color";

async function columnExists(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  table: string,
  column: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS options_color (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        color varchar NOT NULL,
        description text,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb,
        CONSTRAINT options_color_color_unique UNIQUE (color),
        CONSTRAINT options_color_color_format_check
          CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
      )
    `);

    await tx.execute(sql`
      ALTER TABLE trust_benefits
      ADD COLUMN IF NOT EXISTS color_option_id varchar
    `);

    // Migrations 1129 and 1130 were applied inconsistently across databases.
    // Read and migrate the old column only when it exists; the new reference
    // stays nullable on databases where either earlier migration was skipped.
    if (await columnExists(tx, "trust_benefits", "color")) {
      const legacyRows = await tx.execute(sql`
        SELECT DISTINCT color
        FROM trust_benefits
        WHERE color IS NOT NULL
        ORDER BY color
      `);
      const legacyColors = legacyRows.rows.map((row) => row.color);
      const invalidColors = legacyColors.filter((color) => !isValidHexColor(color));
      if (invalidColors.length > 0) {
        throw new Error(
          `Cannot migrate trust benefit colors: unsupported color value(s): ${invalidColors.join(", ")}`,
        );
      }

      for (const color of legacyColors as string[]) {
        await tx.execute(sql`
          INSERT INTO options_color (name, color)
          VALUES (${`Legacy ${color.toUpperCase()}`}, ${color})
          ON CONFLICT (color) DO NOTHING
        `);
      }
      await tx.execute(sql`
        UPDATE trust_benefits AS benefit
        SET color_option_id = option.id
        FROM options_color AS option
        WHERE benefit.color_option_id IS NULL
          AND benefit.color = option.color
      `);
      await tx.execute(sql`
        ALTER TABLE trust_benefits DROP COLUMN IF EXISTS color
      `);
    }

    await tx.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'trust_benefits'::regclass
            AND conname = 'trust_benefits_color_option_id_options_color_id_fk'
        ) THEN
          ALTER TABLE trust_benefits
            ADD CONSTRAINT trust_benefits_color_option_id_options_color_id_fk
            FOREIGN KEY (color_option_id)
            REFERENCES options_color(id)
            ON DELETE RESTRICT;
        END IF;
      END
      $$
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_trust_benefits_color_option_id
      ON trust_benefits (color_option_id)
    `);
  });

  logger.info("Normalized trust benefit colors into reusable options", {
    service: "migration-1207",
  });
}

const migration: Migration = {
  version: 1207,
  name: "normalize_trust_benefit_colors",
  description:
    "Create validated color options, migrate existing trust benefit colors to nullable option references, and remove the raw trust_benefits color column.",
  up,
};

registerMigration(migration);

export default migration;
