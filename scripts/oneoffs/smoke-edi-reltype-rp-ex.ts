/**
 * Smoke test: relation-code taxonomy (RP / EX) across EDI mappings.
 *
 * S1-taxonomy rulings (2026-08-05): RP is the QMSCO (RP variant) child and
 * must follow every QMSCO rule; EX (Ex Spouse — S1 "ES" retired) must never
 * emit a self- or spouse-like code in any carrier file.
 *
 * Pure-function checks only (no DB). Also greps the plugin sources to
 * assert the retired "ES" code never reappears in a mapping list.
 *
 * Usage: npx tsx scripts/oneoffs/smoke-edi-reltype-rp-ex.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isQmscoRelation } from "../../server/plugins/trust/provider-edi/base";
import { accountRole as kaiserAccountRole } from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-kaiser";
import { memberType as healthnetMemberType } from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-healthnet";
import { deltaMemberClassification } from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-delta";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
}

// isQmscoRelation is the shared choke point
check("isQmscoRelation(QMSCO)", isQmscoRelation("QMSCO"), true);
check("isQmscoRelation(RP)", isQmscoRelation("RP"), true);
check("isQmscoRelation(EX)", isQmscoRelation("EX"), false);
check("isQmscoRelation(C)", isQmscoRelation("C"), false);
check("isQmscoRelation(null)", isQmscoRelation(null), false);

// Kaiser: RP = child role like QMSCO (06) + QMSCO supplemental applies via
// isQmscoRelation; EX must not be self (01) or spouse (07).
check("kaiser accountRole(QMSCO)", kaiserAccountRole("QMSCO"), "06");
check("kaiser accountRole(RP)", kaiserAccountRole("RP"), "06");
check("kaiser accountRole(EX)", kaiserAccountRole("EX"), "");
check("kaiser accountRole(SP)", kaiserAccountRole("SP"), "07");
check("kaiser accountRole(null)", kaiserAccountRole(null), "01");

// HealthNet: RP = Q like QMSCO; EX must not be M (self) or S (spouse).
check("healthnet memberType(QMSCO)", healthnetMemberType("QMSCO"), "Q");
check("healthnet memberType(RP)", healthnetMemberType("RP"), "Q");
check("healthnet memberType(EX)", healthnetMemberType("EX"), "");
check("healthnet memberType(SP)", healthnetMemberType("SP"), "S");
check("healthnet memberType(null)", healthnetMemberType(null), "M");

// Delta (representative SMF fixed-width mapping): RP → 13 like QMSCO, EX blank.
check("delta classification(RP)", deltaMemberClassification("RP"), "13");
check("delta classification(EX)", deltaMemberClassification("EX"), "");

// Retired "ES" code must never reappear in any EDI plugin mapping.
const pluginDir = join(process.cwd(), "server/plugins/trust/provider-edi/plugins");
for (const f of readdirSync(pluginDir).filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(join(pluginDir, f), "utf8");
  // Match only code usages ("ES" in a list or comparison), not prose
  // comments that mention the retired code.
  const hasEs = /===\s*["']ES["']|["']ES["']\s*,/.test(src);
  if (hasEs) failures++;
  console.log(`${hasEs ? "FAIL" : "PASS"} no retired "ES" code in ${f}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
