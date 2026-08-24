#!/usr/bin/env tsx
/**
 * Signed-document sanitization diff report.
 *
 * The e-signature renders (`esigs.doc_render`) are snapshots of documents a
 * worker actually put their name to, and each one is hashed at signing time.
 * Sanitizing them at render is defence against a stored-XSS payload reaching
 * a later viewer — but it must not quietly change what a signed document
 * SAYS. The `signed-document` policy was sized against the markup these
 * records actually contain, and this script is how that claim stays checkable.
 *
 * It sanitizes every stored `doc_render` under `signed-document` and reports
 * any record whose output differs from what is stored, so a difference is
 * surfaced to a human rather than silently rendered.
 *
 * A difference is not automatically a bug: a record carrying a genuine XSS
 * payload SHOULD differ, and that is the whole point. What must not happen is
 * a difference nobody looked at. Read each one and decide.
 *
 * Run with:  npx tsx scripts/dev/test-signed-document-sanitize.ts
 *
 * Exits 0 when every stored record survives sanitization byte-identical,
 * 1 when any record differs (so it cannot pass unread in an automated run).
 */
import { sql } from "drizzle-orm";
import { sanitizeHtmlReportingChange } from "@shared/utils/html";
// Import the db module directly rather than through a barrel: a standalone
// tsx script that pulls a barrel in drags plugin-registry init along with it.
import { db, pool } from "../../server/storage/db";

/** Show where two strings first diverge, with a little context either side. */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 40);
  return [
    `    first difference at offset ${i}`,
    `      stored:    …${a.slice(from, i + 80)}…`,
    `      sanitized: …${b.slice(from, i + 80)}…`,
  ].join("\n");
}

async function main(): Promise<void> {
  const result = await db.execute(
    sql`SELECT id, doc_render FROM esigs WHERE doc_render IS NOT NULL AND doc_render <> '' ORDER BY id`,
  );
  const rows = (result.rows ?? result) as unknown as Array<{
    id: string;
    doc_render: string;
  }>;

  /** Markup the policy actually removed — a reader sees a different document. */
  const contentChanges: Array<{ id: string; stored: string; clean: string }> = [];
  /** Same characters, different entity spelling — renders identically. */
  const encodingOnly: string[] = [];

  for (const row of rows) {
    const { clean, contentChanged } = sanitizeHtmlReportingChange(
      row.doc_render,
      "signed-document",
    );
    if (contentChanged) {
      contentChanges.push({ id: row.id, stored: row.doc_render, clean });
    } else if (clean !== row.doc_render) {
      encodingOnly.push(row.id);
    }
  }

  console.log(
    `[test-signed-document-sanitize] ${rows.length} stored signed document(s) checked under the 'signed-document' policy.`,
  );

  if (encodingOnly.length > 0) {
    // Not a finding. DOMPurify re-serializes the DOM it parsed, so a stored
    // `&#10003;` comes back as a literal `✓`. Same glyph on screen; called
    // out only so the count below is not mistaken for "nothing was touched".
    console.log(
      `[test-signed-document-sanitize] ${encodingOnly.length} document(s) differ in entity spelling only (e.g. '&#10003;' → '✓') and render identically.`,
    );
  }

  if (contentChanges.length === 0) {
    console.log(
      "[test-signed-document-sanitize] OK — no stored signed document loses any markup under this policy; every viewer sees what the signer saw.",
    );
    await pool.end();
    process.exit(0);
  }

  console.error(
    [
      "",
      `[test-signed-document-sanitize] ${contentChanges.length} signed document(s) LOSE MARKUP under sanitization.`,
      "",
      "Each of these renders differently to a viewer than what was signed and",
      "hashed. Decide per record which it is:",
      "  • the record carries legitimate markup the policy should permit →",
      "    widen 'signed-document' in shared/utils/html/policies.ts, or",
      "  • the record carries markup that must not render → the strip is the",
      "    fix, and EsigView already surfaces it to the viewer as an advisory.",
      "",
      ...contentChanges.flatMap((c) => [
        `  esig ${c.id}`,
        firstDifference(c.stored, c.clean),
        "",
      ]),
    ].join("\n"),
  );
  await pool.end();
  process.exit(1);
}

main().catch((err) => {
  console.error("[test-signed-document-sanitize] failed:", err);
  process.exit(1);
});
