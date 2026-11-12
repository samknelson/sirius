import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { getEnvironmentVariable, isEnvironmentVariableSetInProcess } from "../../../server/config/env-registry";
import { parseFileSystemsEnv } from "../../../server/services/files/config";
import { decodeHtmlEntities } from "../../../shared/utils/html/entities";

/**
 * Conservative identity matching: only exact managed image src URLs on the
 * configured origin prove a template association. No basename/substring match.
 * Unknown historic origins are retained without inventing an owner.
 */
export function managedImageReferences(content: unknown, origin: string | undefined): Set<string> {
  const result = new Set<string>();
  if (!origin || !content || typeof content !== "object") return result;
  let expected: URL;
  try { expected = new URL(origin); } catch { return result; }
  for (const html of Object.values(content)) {
    if (typeof html !== "string") continue;
    // Ignore inert/commented content; uncertain markup remains unassociated.
    const active = html.replace(/<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    for (const tag of active.matchAll(/<img\b[^>]*>/gi)) {
      const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]);
      if (!src) continue;
      try {
        const url = new URL(decodeHtmlEntities(src[1] ?? src[2] ?? src[3]));
        if (url.origin !== expected.origin || url.username || url.password || url.search || url.hash) continue;
        const parts = url.pathname.split("/").slice(1);
        if (parts.shift() !== "public-files" || parts.length < 2) continue;
        const fs = decodeURIComponent(parts.shift()!);
        const path = parts.map(decodeURIComponent).join("/");
        result.add(JSON.stringify([fs, path]));
      } catch { /* Unproven reference: keep the published file, not a guessed parent. */ }
    }
  }
  return result;
}

async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    // Migrations precede the override-cache installation. Honor saved settings
    // without mutating the global registry or treating fallback URLs as explicit.
    const settings = (await tx.execute(sql`SELECT name, value FROM variables
      WHERE name IN ('ENV_PUBLIC_URL', 'ENV_FILESYSTEMS')`)).rows as any[];
    const configured = (name: string) => {
      const saved = settings.find(row => row.name === `ENV_${name}`)?.value;
      return !isEnvironmentVariableSetInProcess(name) && typeof saved === "string" && saved
        ? saved : getEnvironmentVariable(name);
    };
    const origin = configured("PUBLIC_URL");
    const fileSystems = parseFileSystemsEnv(configured("FILESYSTEMS") ?? "");
    const legacy = (await tx.execute(sql`SELECT * FROM files
      WHERE entity_type IN ('template-asset', 'entity-files:template_asset') FOR UPDATE`)).rows as any[];
    const templates = (await tx.execute(sql`SELECT id, content FROM letter_templates FOR UPDATE`)).rows as any[];
    const references = new Map<string, Set<string>>();
    for (const template of templates) {
      for (const key of managedImageReferences(template.content, origin)) {
        const owners = references.get(key) ?? new Set<string>();
        owners.add(template.id);
        references.set(key, owners);
      }
    }
    for (const file of legacy) {
      const links = (await tx.execute(sql`SELECT * FROM entity_files WHERE file_id = ${file.id} FOR UPDATE`)).rows as any[];
      if (links.some(link => link.context_id !== "template_asset" || link.entity_id !== file.entity_id)) {
        throw new Error("Published image has conflicting ownership; resolve before retiring legacy owners.");
      }
      const owners = references.get(JSON.stringify([file.file_system_id, file.storage_path]));
      const owner = owners?.size === 1 ? [...owners][0] : null;
      // Only ownership changes. IDs, status, filesystem, object path and bytes
      // remain untouched; ambiguous/shared/unreferenced images stay published.
      await tx.execute(sql`UPDATE files SET entity_type = ${owner ? "entity-files:letter_template" : "published-image"},
        entity_id = ${owner} WHERE id = ${file.id}`);
      if (owner) {
        await tx.execute(sql`INSERT INTO entity_files (context_id, entity_id, file_id, name)
          VALUES ('letter_template', ${owner}, ${file.id}, ${file.file_name.slice(0, 255)})
          ON CONFLICT (file_id) DO UPDATE SET context_id = 'letter_template', entity_id = EXCLUDED.entity_id`);
      } else {
        await tx.execute(sql`DELETE FROM entity_files WHERE file_id = ${file.id} AND context_id = 'template_asset'`);
      }
    }
    const remaining = await tx.execute(sql`SELECT id FROM entity_files WHERE context_id = 'template_asset' LIMIT 1`);
    if (remaining.rows.length) throw new Error("Unrecognized legacy image attachments remain; refusing owner removal.");
    const variables = (await tx.execute(sql`SELECT id, value FROM variables WHERE name = 'entity_files_config' FOR UPDATE`)).rows as any[];
    for (const variable of variables) {
      const config = variable.value;
      if (!config || typeof config !== "object" || Array.isArray(config)) continue;
      const old = config.template_asset;
      if (old && typeof old.file_system === "string" &&
          fileSystems.get(old.file_system)?.access === "public" &&
          typeof old.directory === "string" && old.directory.trim() && !old.directory.includes("..") &&
          !(old.directory.match(/:[a-z0-9-]+/gi) ?? []).some((t: string) => t !== ":entity-id") &&
          Array.isArray(old.allowed) && old.allowed.length &&
          old.allowed.every((ext: unknown) => typeof ext === "string" && ["png", "jpg", "jpeg"].includes(ext))) {
        for (const key of ["letter_template", "bulk_message", "worker_public"]) {
          if (!(key in config)) config[key] = { ...old };
        }
      }
      delete config.template_asset;
      await tx.execute(sql`UPDATE variables SET value = ${JSON.stringify(config)}::jsonb WHERE id = ${variable.id}`);
    }
    // Provenance belongs to retired synthetic records, not to the file IDs.
    await tx.execute(sql`DELETE FROM entity_metadata WHERE context_id = 'template_assets'`);
    await tx.execute(sql`DROP TABLE IF EXISTS template_assets`);
  });
}

const migration: Migration = {
  version: 1219,
  name: "real_owner_public_images",
  description: "Retire synthetic image owners while retaining published file identities and URLs.",
  up,
};
registerMigration(migration);
export default migration;
