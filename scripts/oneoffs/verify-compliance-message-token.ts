/**
 * One-off verification for
 * {{employer.compliance_message(wizard=…, account=…, date=…)}}.
 *
 * Covers the happy path, the `date` default, and every way the chain is
 * meant to render nothing: a wizard type id naming no registered wizard
 * plugin, and an unknown ledger account sirius id.
 *
 * The `wizard` argument names a WIZARD TYPE — the id a wizard plugin
 * registers itself under, the same identifier the Upload Type select on
 * /employers/compliance uses. There is deliberately no `plugin_configs`
 * row involved: the `wizard` plugin kind has no adapter and no UI, so an
 * id from that table is one no author could obtain.
 *
 * Creates its own throwaway ledger account and deletes it again — it
 * never renders against, or mutates, real compliance data.
 *
 * Run: npx tsx scripts/oneoffs/verify-compliance-message-token.ts
 */
import { employers } from "../../shared/schema";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { currentYearMonth } from "../../server/plugins/tokens/plugins/compliance";
import { storage } from "../../server/storage/database";
import { loadComponentCache } from "../../server/services/component-cache";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const STAMP = Date.now().toString(36).toUpperCase();
const ACCOUNT_SIRIUS = `VERIFY-CMT-ACCT-${STAMP}`;
const ACCOUNT_NAME = "Verification Compliance Account";
const SAMPLE_DATE = "2031-04";

async function main() {
  await loadComponentCache();
  initializeTokenPluginSystem();
  // Importing the barrel is what registers the bundled wizard plugins.
  const { wizardPluginRegistry } = await import("../../server/plugins/wizards");
  const {
    renderTokens,
    createTokenEvalContext,
    validateTokenExpressionForRoots,
  } = await import("../../server/plugins/tokens");

  const wizardPlugin = wizardPluginRegistry.list()[0];
  if (!wizardPlugin) {
    check("at least one wizard plugin is registered", false);
    process.exit(1);
  }
  const WIZARD_ID = wizardPlugin.id;
  const WIZARD_NAME = wizardPlugin.name;
  console.log(`Using wizard type "${WIZARD_ID}" (${WIZARD_NAME})`);

  const employer = (await storage.employers.getAllEmployers()).find(
    (e) => typeof e.name === "string" && e.name.trim(),
  );
  if (!employer) {
    check("an employer with a name exists to render against", false);
    process.exit(1);
  }
  const employerName = employer.name.trim();

  const created: Array<() => Promise<unknown>> = [];
  try {
    const account = await storage.ledger.accounts.create({
      name: ACCOUNT_NAME,
      siriusId: ACCOUNT_SIRIUS,
    });
    created.push(() => storage.ledger.accounts.delete(account.id));

    const seedCtx = () =>
      createTokenEvalContext(storage, undefined, {
        seeds: [
          {
            name: "employer",
            entity: {
              kind: "employer",
              row: employer as unknown as Record<string, unknown>,
              table: employers,
            },
          },
        ],
      });
    const render = async (expr: string) =>
      (await renderTokens(`{{${expr}}}`, seedCtx())).output;

    const sentence = (wizardName: string, date: string, accountName: string) =>
      `I am the example compliance message for ${employerName} for uploads ` +
      `of type ${wizardName} (${date}). I am operating against account ` +
      `${accountName}. Hear me roar.`;

    console.log("\n--- validation ---");
    for (const [expr, shouldPass] of [
      [
        `employer.compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}")`,
        true,
      ],
      // `date` is optional, so both arities are valid.
      [
        `employer.compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}", date="${SAMPLE_DATE}")`,
        true,
      ],
      [`employer.compliance_message(wizard="${WIZARD_ID}")`, false],
      [`employer.compliance_message(account="${ACCOUNT_SIRIUS}")`, false],
      [`employer.compliance_message(date="${SAMPLE_DATE}")`, false],
      ["employer.compliance_message", false],
      // Reach is by ENTITY KIND, which is what "only from an employer"
      // means: never a bare root, never a non-employer entity, but any
      // chain that has actually arrived at an employer — the leaf reads
      // that employer's own name, exactly as `employer.name` would.
      [
        `compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}")`,
        false,
      ],
      [
        `worker.compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}")`,
        false,
      ],
      [
        `worker.home_employer.compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}")`,
        true,
      ],
    ] as const) {
      const v = validateTokenExpressionForRoots(expr, ["employer", "worker"]);
      check(
        `{{${expr}}} ${shouldPass ? "validates" : "is rejected"}`,
        v.ok === shouldPass,
        v.ok ? undefined : v.error,
      );
    }

    console.log("\n--- happy path (explicit date) ---");
    const happy = await render(
      `employer.compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}", date="${SAMPLE_DATE}")`,
    );
    console.log(`  "${happy}"`);
    check(
      "renders the full sentence with the supplied date",
      happy === sentence(WIZARD_NAME, SAMPLE_DATE, ACCOUNT_NAME),
    );

    console.log("\n--- date defaults to the current year-month ---");
    const defaulted = await render(
      `employer.compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}")`,
    );
    console.log(`  "${defaulted}"`);
    check(
      "omitted date renders the current year-month",
      defaulted === sentence(WIZARD_NAME, currentYearMonth(), ACCOUNT_NAME),
      currentYearMonth(),
    );
    check(
      "the default is a real YYYY-MM, not a frozen literal",
      /^\d{4}-(0[1-9]|1[0-2])$/.test(currentYearMonth()),
      currentYearMonth(),
    );
    // The regression this guards is a default that freezes at boot, which
    // today's date alone cannot demonstrate. Drive the helper across a
    // month boundary explicitly: distinct inputs must give distinct,
    // correctly zero-padded periods.
    for (const [when, expected] of [
      [new Date(2031, 0, 5), "2031-01"],
      [new Date(2031, 8, 30), "2031-09"],
      [new Date(2031, 11, 31), "2031-12"],
      [new Date(2032, 0, 1), "2032-01"],
    ] as const) {
      const got = currentYearMonth(when);
      check(
        `${when.toDateString()} yields ${expected}`,
        got === expected,
        got,
      );
    }
    // A blank value is the same as no value: the parenthetical must never
    // render empty.
    const blankDate = await render(
      `employer.compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}", date="")`,
    );
    check(
      "blank date falls back to the current year-month too",
      blankDate === sentence(WIZARD_NAME, currentYearMonth(), ACCOUNT_NAME),
      `"${blankDate}"`,
    );

    console.log("\n--- unresolvable arguments render nothing ---");
    for (const [label, expr] of [
      [
        "wizard type id naming no registered plugin",
        `employer.compliance_message(wizard="no_such_wizard_type", account="${ACCOUNT_SIRIUS}")`,
      ],
      [
        "unknown account sirius id",
        `employer.compliance_message(wizard="${WIZARD_ID}", account="NO-SUCH-ACCT")`,
      ],
    ] as const) {
      const out = await render(expr);
      check(`${label} renders blank, not a partial sentence`, out === "", `"${out}"`);
    }

    console.log("\n--- sample mode (each employer persona) ---");
    for (const persona of ["martian", "historical", "mythological"]) {
      const ctx = createTokenEvalContext(storage, undefined, {
        sample: true,
        sampleSetIds: { employer: persona },
      });
      const out = (
        await renderTokens(
          `{{employer.compliance_message(wizard="${WIZARD_ID}", account="${ACCOUNT_SIRIUS}")}}`,
          ctx,
        )
      ).output;
      console.log(`  ${persona}: "${out}"`);
      check(
        `${persona} persona previews a coherent sentence`,
        out.startsWith("I am the example compliance message for") &&
          out.endsWith("Hear me roar.") &&
          // Each persona supplies its own sentence rather than falling
          // back to the metadata example.
          !out.includes("Monthly Hours Upload") &&
          // The persona sentence carries a period of its own.
          /\(\d{4}-\d{2}\)/.test(out),
      );
    }
  } finally {
    for (const undo of created.reverse()) {
      try {
        await undo();
      } catch (err) {
        console.log(`  cleanup failed: ${(err as Error).message}`);
        failures++;
      }
    }
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
