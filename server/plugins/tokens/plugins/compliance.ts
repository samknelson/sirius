import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEvalContext } from "../types";

/**
 * {{employer.compliance_message(wizard="…", account="…", date="…")}} — a
 * sentence describing an employer's compliance standing for one kind of
 * upload, in one period, measured against one ledger account.
 *
 *   - `wizard`  — the WIZARD TYPE's id: the same string every other
 *                 surface uses to mean "this kind of upload". It is the
 *                 `name` field of /api/wizard-types, the value behind the
 *                 Upload Type select on /employers/compliance, that
 *                 page's `wizardType` query param, and the id a wizard
 *                 plugin registers itself under (for example
 *                 "gbhet_legal_workers_monthly").
 *   - `account` — the sirius id of a ledger account. An EXTERNAL
 *                 identifier, not the internal row id: the author writes
 *                 the id the rest of the organization uses, and the token
 *                 survives a re-import that changes primary keys.
 *   - `date`    — the reporting period, defaulting to the current
 *                 year-month.
 *
 * A wizard type is NOT a `plugin_configs` row. The `wizard` plugin kind
 * has no config adapter, no admin UI and no rows, so an earlier draft of
 * this token asked for a sirius id that an author had no way to obtain.
 * A wizard type is declared in code, so its registered id is the durable
 * name for it.
 *
 * No argument declares `choices`, and `date` does not declare a static
 * `default`. Both are read from metadata built once when this plugin
 * registers. A frozen `choices` list would reject ledger accounts minted
 * after boot (and wizard plugins that register after the token plugins
 * do); a frozen `default` would bake in whatever month the server booted
 * in and silently misreport every later month.
 */
const COMPONENT = "ledger";

/** The reporting period used when the author supplies no `date`. */
export function currentYearMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The upload type's display name, or null when the id names no
 * registered wizard type. Echoing an unrecognized id back into the
 * sentence would dress a typo up as a real upload type.
 */
async function loadWizardName(wizardTypeId: string): Promise<string | null> {
  // Dynamic import: `server/storage` imports the wizard registry, so a
  // static import here would close a storage → tokens → wizards → storage
  // cycle (see the header of server/plugins/wizards/registry.ts).
  const { wizardPluginRegistry } = await import("../../wizards/registry");
  const plugin = wizardPluginRegistry.get(wizardTypeId);
  return plugin?.name?.trim() || null;
}

/** Resolve the ledger account named by a sirius id, or null. */
async function loadAccountName(
  ctx: TokenEvalContext,
  siriusId: string,
): Promise<string | null> {
  return memo(ctx, `compliance:account-name:${siriusId}`, async () => {
    const account = await ctx.storage.ledger.accounts.getBySiriusId(siriusId);
    if (!account) return null;
    return account.name?.trim() || null;
  });
}

/** The one wording every surface renders — sample previews included. */
export function composeComplianceMessage(
  employerName: string,
  wizardName: string,
  date: string,
  accountName: string,
): string {
  return (
    `I am the example compliance message for ${employerName} for uploads ` +
    `of type ${wizardName} (${date}). I am operating against account ` +
    `${accountName}. Hear me roar.`
  );
}

registerTokenPlugin({
  metadata: {
    id: "token.employer.compliance_message",
    name: "Compliance message",
    shortLabel: "compliance message",
    description:
      "The employer's compliance message for one upload type and period, " +
      "measured against one ledger account",
    segmentName: "compliance_message",
    inputTypes: ["employer"],
    outputType: "value",
    // The `account` argument is meaningless without the ledger. Gating is
    // OFFER-only: a template already naming this token keeps validating
    // and renders blank while the component is off.
    requiredComponent: COMPONENT,
    args: {
      wizard: {
        required: true,
        description:
          'Wizard type id of the upload type, as listed by the Upload Type ' +
          'select on the employer compliance page (e.g. ' +
          '"gbhet_legal_workers_monthly")',
      },
      account: {
        required: true,
        description: "Sirius ID of the ledger account to measure against",
      },
      date: {
        required: false,
        description:
          "Reporting period as YYYY-MM. Defaults to the current year-month " +
          "when omitted.",
      },
    },
    // Fallback for a persona that does not name this leaf; the three
    // employer personas each supply their own sentence. The date is a
    // fixed sample, not the current month: this runs once at
    // registration, so a computed value would freeze at boot.
    example: composeComplianceMessage(
      "Olympus Mons Freight",
      "Monthly Hours Upload",
      "2049-07",
      "Health & Welfare Trust",
    ),
  },
  async resolve(entity, args, ctx) {
    const employer = tokenEntityOf(entity, "employer");
    const employerName =
      typeof employer?.row.name === "string" ? employer.row.name.trim() : "";
    if (!employerName) return null;

    const wizardTypeId = (args.wizard ?? "").trim();
    const accountSiriusId = (args.account ?? "").trim();
    if (!wizardTypeId || !accountSiriusId) return null;
    // Computed per render, so the period follows the calendar rather than
    // the process's uptime.
    const date = (args.date ?? "").trim() || currentYearMonth();

    const [wizardName, accountName] = await Promise.all([
      loadWizardName(wizardTypeId),
      loadAccountName(ctx, accountSiriusId),
    ]);
    // A half-resolved sentence would read as fact. Render the chain's
    // default (the author's `defaultValue`, else blank) instead.
    if (!wizardName || !accountName) return null;

    return composeComplianceMessage(
      employerName,
      wizardName,
      date,
      accountName,
    );
  },
});
