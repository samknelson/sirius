import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext, WizardStepHandler } from "../types";
import type { Wizard, InsertWizard } from "@shared/schema";
import {
  trustProviderEdiPluginRegistry,
  type TrustProviderEdiContext,
  type TrustProviderEdiPlugin,
} from "../../trust/provider-edi/registry";
import { assembleEdiFileLines } from "../../trust/provider-edi/base";
import { carrierLayoutCsv } from "../../trust/provider-edi/carrier-csv";
import {
  effectiveRunTerminationPolicy, newRunTerminationPolicy, terminationPolicyFields,
  readTerminationPolicy,
} from "../../trust/provider-edi/termination-policy";
import { validateAgainstSchema } from "../../../lib/json-schema-validator";
import { readCoverageEvidence } from "../../trust/provider-edi/coverage-evidence";
import { evidenceHash, type CoverageEvidence } from "../../trust/provider-edi/coverage-conflicts";
import { conflictRuleInForce } from "../../trust/provider-edi/coverage-settings";
import {
  COVERAGE_ENTRY_PK, coverageEntriesCsv, coverageSummary, savedCoverageEntries, snapshotLists,
} from "../../trust/provider-edi/coverage-report";
import type {
  EdiCoverageAcknowledgement, EdiCoverageEntry, EdiCoverageReview, EdiCoverageRunSummary,
} from "@shared/edi-coverage-choices";

/**
 * The single trust-provider EDI wizard. Generation, preview, and SFTP
 * delivery of EDI files are generic; the file's contents and encoding are
 * deferred to the EDI plugin named by the configuration picked in the
 * first step. Gated by the same component as the plugin kind.
 *
 * Wizard data shape:
 * - `config`  — { configId, pluginId, name, providerId, sftpClientId, data }
 * - `input`   — parameter-step values (validated against plugin.inputSchema)
 * - `coverageSnapshot` — the last Coverage sources check: rule, counts, lists
 * - `coverageAcknowledgement` — who accepted which exclusion list, and when
 * - `reportMeta` / rows in wizard_report_data — standard report machinery;
 *   `reportMeta.coverage` records the rule and exclusion counts of that run,
 *   and the run's exclusion list is saved beside its rows
 * - `delivery`— { deliveredAt, deliveredBy, filename, rowCount, destinationId, destinationName }
 */

const WIZARD_ID = "trust_provider_edi";
const COMPONENT = "trust.providers.edi";

/** A check answers for these settings under this rule, and nothing else. */
function coverageRevision(data: any) {
  return evidenceHash({
    config: data.config, input: data.input, terminationPolicy: data.terminationPolicy,
    rule: conflictRuleInForce(),
  });
}

/** Only an acknowledgement of exactly this list under this rule counts. */
function acknowledgementFor(data: any, exclusionDigest: string, rule: string): EdiCoverageAcknowledgement | null {
  const saved = data?.coverageAcknowledgement as EdiCoverageAcknowledgement | null | undefined;
  return saved && saved.exclusionDigest === exclusionDigest && saved.rule === rule ? saved : null;
}

function coverageSnapshot(evidence: CoverageEvidence, data: any) {
  return {
    rule: evidence.rule, fingerprint: evidence.fingerprint, revision: coverageRevision(data),
    exclusionDigest: evidence.exclusionDigest, checkedAt: new Date().toISOString(),
    population: evidence.population, timings: evidence.timings,
    ...coverageSummaryCounts(evidence),
    // Bound what is saved for the screen, never what a run excludes or reports.
    ...snapshotLists(evidence.exclusions, evidence.warnings),
  };
}
function coverageSummaryCounts(evidence: CoverageEvidence) {
  const { exclusionCount, warningCount, byReason } = coverageSummary(evidence, null);
  return { exclusionCount, warningCount, byReason };
}

function hasGeneratedReport(wizard: Wizard): boolean {
  const data = wizard.data as any;
  const status = data?.progress?.run?.status;
  // Older saved reports predate run progress. Preserve those downloads, but
  // once a run has progress only its completed state can expose output.
  return !!data?.reportMeta && (status === undefined || status === "completed");
}

/** A regeneration may start while rows are read. Never pair those rows with old metadata. */
async function completedRows(ctx: WizardStepContext) {
  const rows = await ctx.storage.wizards.getReportData(ctx.wizardId);
  const fresh = await ctx.storage.wizards.getById(ctx.wizardId);
  if (!fresh || !hasGeneratedReport(fresh) ||
      JSON.stringify((fresh.data as any)?.reportMeta) !== JSON.stringify((ctx.wizard.data as any)?.reportMeta)) {
    throw new Error("Generation changed while reading output. Reload the completed generation.");
  }
  return rows;
}
/** The run's exclusion list is saved beside its rows; it is never a file row. */
const fileRows = <T extends { pk: string }>(rows: T[]) => rows.filter(row => !row.pk.startsWith(COVERAGE_ENTRY_PK));

interface SelectedConfig {
  configId: string;
  pluginId: string;
  name: string | null;
  providerId: string | null;
  sftpClientId: string | null;
  data: Record<string, unknown>;
}

function readSelectedConfig(wizard: Wizard): SelectedConfig | null {
  const data = (wizard.data as any) || {};
  return data.config?.configId ? (data.config as SelectedConfig) : null;
}

function resolvePlugin(pluginId: string): TrustProviderEdiPlugin {
  const plugin = trustProviderEdiPluginRegistry.get(pluginId);
  if (!plugin) {
    throw new Error(`EDI plugin '${pluginId}' is not registered`);
  }
  return plugin;
}

function savedParameters(wizard: Wizard): Record<string, unknown> {
  const data = (wizard.data as any) ?? {};
  const plugin = readSelectedConfig(wizard);
  return {
    ...data.input,
    ...(plugin && resolvePlugin(plugin.pluginId).benefitSiriusIds?.length
      ? terminationPolicyFields(effectiveRunTerminationPolicy(data)) : {}),
  };
}

function parameterSchema(wizard: Wizard) {
  const selected = readSelectedConfig(wizard);
  const plugin = selected && resolvePlugin(selected.pluginId);
  const schema = plugin?.inputSchema ?? { type: "object", properties: {} };
  if (!plugin?.benefitSiriusIds?.length) return schema;
  // AJV/RJSF defaults must reflect this record, not activate an old run.
  const fields = terminationPolicyFields(effectiveRunTerminationPolicy((wizard.data as any) ?? {}));
  return { ...schema, properties: {
    ...schema.properties,
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) =>
      [key, { ...schema.properties?.[key], default: value }])),
  } };
}

function generationBlocker(wizard: Wizard): string | undefined {
  try {
    const selected = readSelectedConfig(wizard);
    if (!selected) return "Pick an EDI configuration first.";
    if (!(wizard.data as any)?.input) return "Save Parameters before generating.";
    const validation = validateAgainstSchema(parameterSchema(wizard), savedParameters(wizard));
    if (!validation.valid) return `Correct and save Parameters: ${validation.errors?.join("; ")}`;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid saved termination policy.";
  }
}

function invalidatedData(wizard: Wizard) {
  const data = (wizard.data as any) ?? {};
  if (data.progress?.run?.status === "in_progress") throw new Error("Generation is active. Wait before changing settings.");
  if (data.progress?.coverage?.status === "in_progress") throw new Error("Coverage checking is active. Wait before changing settings.");
  return {
    reportMeta: null, recordCount: null, delivery: null,
    // Source choices saved by older runs stay on the record, read-only.
    coverageReviewed: false,
    coverageSnapshot: null,
    coverageAcknowledgement: null,
    previousGeneration: data.progress?.run ?? data.previousGeneration ?? null,
    progress: { ...data.progress, coverage: null, run: null, results: null, deliver: null },
  };
}

function buildEdiContext(
  ctx: WizardStepContext,
  selected: SelectedConfig,
  completedOutput = false,
): TrustProviderEdiContext {
  const data = (ctx.wizard.data as any) || {};
  const snapshot = completedOutput ? data.reportMeta?.generationContext : undefined;
  return {
    coverageCorrelation: { wizardId: ctx.wizardId, runId: ctx.runId },
    configId: selected.configId,
    configData: snapshot?.configData ?? selected.data ?? {},
    providerId: selected.providerId,
    sftpClientId: selected.sftpClientId,
    input: (snapshot?.input ?? data.input ?? {}) as Record<string, unknown>,
    terminationPolicy: snapshot?.terminationPolicy ?? effectiveRunTerminationPolicy(data),
    storage: ctx.storage,
  };
}

/** Step 1 — pick an enabled EDI configuration. */
const configStep: WizardStepHandler = {
  id: "config",
  name: "Configuration",
  description: "Pick which EDI file configuration to generate",
  kind: "custom",
  component: "ConfigPicker",
  getState: (wizard) => (readSelectedConfig(wizard) ? "completed" : "pending"),
  getData: async (ctx) => {
    const envelopes = await ctx.storage.pluginConfigs.search("trust-provider-edi", {
      enabled: true,
    });
    const configs = envelopes
      .map((e) => {
        const plugin = trustProviderEdiPluginRegistry.get(e.config.pluginId);
        return {
          configId: e.config.id,
          pluginId: e.config.pluginId,
          pluginName: plugin?.name ?? e.config.pluginId,
          name: e.config.name,
          providerId: (e.subsidiary as any)?.providerId ?? null,
          sftpClientId: (e.subsidiary as any)?.sftpClientId ?? null,
        };
      })
      .filter((c) => trustProviderEdiPluginRegistry.get(c.pluginId));
    return { configs, selected: readSelectedConfig(ctx.wizard) };
  },
  submit: async (ctx) => {
    const configId = String(ctx.input.configId ?? "");
    if (!configId) throw new Error("configId is required");
    const envelope = await ctx.storage.pluginConfigs.getWithSubsidiary(configId);
    if (
      !envelope ||
      envelope.config.pluginKind !== "trust-provider-edi" ||
      !envelope.config.enabled
    ) {
      throw new Error("Selected EDI configuration was not found or is disabled");
    }
    resolvePlugin(envelope.config.pluginId);
    const selected: SelectedConfig = {
      configId: envelope.config.id,
      pluginId: envelope.config.pluginId,
      name: envelope.config.name,
      providerId: (envelope.subsidiary as any)?.providerId ?? null,
      sftpClientId: (envelope.subsidiary as any)?.sftpClientId ?? null,
      data: (envelope.config.data ?? {}) as Record<string, unknown>,
    };
    // Changing the config invalidates any previously generated output.
    return {
      status: "draft",
      data: {
        ...invalidatedData(ctx.wizard),
        config: selected,
        input: null,
        // Capture OLD effective choices before replacing the snapshot.
        terminationPolicy: terminationPolicyFields(effectiveRunTerminationPolicy((ctx.wizard.data as any) ?? {})),
      },
    };
  },
};

/** Step 2 — plugin-specific run parameters (as-of date, etc.). */
const paramsStep: WizardStepHandler = {
  id: "params",
  name: "Parameters",
  description: "Run parameters for the selected EDI file type",
  kind: "form",
  getSchema: parameterSchema,
  getFormData: savedParameters,
  getState: (wizard) => {
    const data = (wizard.data as any) || {};
    return data.input ? "completed" : "pending";
  },
  submit: (ctx) => {
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected) throw new Error("Pick an EDI configuration first");
    const input = { ...ctx.input };
    const validation = validateAgainstSchema(parameterSchema(ctx.wizard), input);
    if (!validation.valid) throw new Error(`Invalid parameters: ${validation.errors?.join("; ")}`);
    return { status: "draft", data: {
      ...invalidatedData(ctx.wizard), input,
      ...(resolvePlugin(selected.pluginId).benefitSiriusIds?.length
        ? { terminationPolicy: terminationPolicyFields(readTerminationPolicy(input)) } : {}),
    } };
  },
};

const coverageStep: WizardStepHandler = {
  id: "coverage",
  name: "Coverage sources",
  description: "Review the coverage records this run leaves out, and acknowledge them",
  kind: "custom",
  component: "CoverageSources",
  requiredPolicy: "admin",
  requiredComponent: COMPONENT,
  retrySafe: true,
  getRunBlocker: generationBlocker,
  getState: wizard => {
    const data = wizard.data as any;
    // An hours-only file reads no coverage: saved Parameters complete the
    // step, with nothing for an administrator to run.
    const selected = readSelectedConfig(wizard);
    if (selected && data?.input && !trustProviderEdiPluginRegistry.get(selected.pluginId)?.benefitSiriusIds?.length)
      return "completed";
    return data?.coverageReviewed === true && data?.progress?.coverage?.status === "completed" ? "completed" : "pending";
  },
  getData: async (ctx): Promise<EdiCoverageReview & Record<string, unknown>> => {
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected) throw new Error("Pick Configuration and save Parameters first.");
    const plugin = resolvePlugin(selected.pluginId);
    const none = { exclusions: [], warnings: [], acknowledgement: null, generated: null, legacyDecisions: [] };
    if (!plugin.benefitSiriusIds?.length) return { applicable: false, ...none };
    const blocker = generationBlocker(ctx.wizard);
    if (blocker) throw new Error(blocker);
    const data = ctx.wizard.data as any;
    const revision = coverageRevision(data);
    // A check saved under other settings, the other rule, or by the retired
    // source picker is not shown as this run's list.
    const saved = data.coverageSnapshot;
    const snapshot = saved?.revision === revision && saved.exclusionDigest ? saved : null;
    const generated = hasGeneratedReport(ctx.wizard);
    return {
      applicable: true, ...none,
      // Always the rule in force NOW.
      rule: conflictRuleInForce(), revision,
      ready: !!snapshot && data.progress?.coverage?.status === "completed",
      ...(snapshot ? {
        fingerprint: snapshot.fingerprint, checkedAt: snapshot.checkedAt, population: snapshot.population,
        timings: snapshot.timings, exclusionDigest: snapshot.exclusionDigest,
        exclusionCount: snapshot.exclusionCount, warningCount: snapshot.warningCount, byReason: snapshot.byReason,
        shown: snapshot.shown, exclusions: snapshot.exclusions, warnings: snapshot.warnings,
        acknowledgement: acknowledgementFor(data, snapshot.exclusionDigest, snapshot.rule),
      } : {}),
      generated: generated ? (data.reportMeta?.coverage as EdiCoverageRunSummary | undefined) ?? null : null,
      // Source choices saved before exclusion became automatic. Read-only:
      // they are shown for the record and applied to nothing.
      legacyDecisions: (generated ? data.reportMeta?.coverageDecisions : null) ?? data.coverageDecisions ?? [],
    };
  },
  exportFile: async (ctx, format) => {
    if (format !== "coverage-exclusions") throw new Error("Unknown EDI download format");
    const data = ctx.wizard.data as any;
    const snapshot = data?.coverageSnapshot;
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected || !snapshot?.exclusionDigest || snapshot.revision !== coverageRevision(data))
      throw new Error("Check Coverage sources before downloading the exclusion list.");
    let entries: EdiCoverageEntry[] = [...snapshot.exclusions, ...snapshot.warnings];
    if (entries.length < snapshot.exclusionCount + snapshot.warningCount) {
      // The saved check kept only what the screen shows. The download is
      // always complete, so read the list again and prove it is the same one.
      const evidence = await readCoverageEvidence(buildEdiContext(ctx, selected), resolvePlugin(selected.pluginId));
      if (evidence.exclusionDigest !== snapshot.exclusionDigest || evidence.warnings.length !== snapshot.warningCount)
        throw new Error("Coverage changed since it was checked. Check Coverage sources again, then download the list.");
      entries = [...evidence.exclusions, ...evidence.warnings];
    }
    return {
      content: coverageEntriesCsv(entries, snapshot.rule),
      filename: `edi-coverage-exclusions-${String(snapshot.checkedAt ?? "").slice(0, 10) || "check"}.csv`,
      mimeType: "text/csv; charset=utf-8",
    };
  },
  prepareRun: async ctx => {
    const action = String(ctx.input.action ?? "check");
    if (action === "decision" || action === "complete")
      throw new Error("Manual source decisions are no longer accepted. Conflicting coverage is left out automatically: check Coverage sources and acknowledge the exclusion list.");
    if (action !== "check" && action !== "acknowledge") throw new Error("Unknown coverage action.");
    const { getEffectiveUser } = await import("../../../modules/masquerade");
    const { dbUser } = await getEffectiveUser((ctx.req as any).session, (ctx.req as any).user);
    if (!dbUser?.id) throw new Error("An effective administrator is required.");
    const selected = readSelectedConfig(ctx.wizard);
    if (action === "acknowledge" && selected && resolvePlugin(selected.pluginId).benefitSiriusIds?.length) {
      const data = ctx.wizard.data as any;
      const revision = coverageRevision(data);
      if (data.progress?.coverage?.status !== "completed")
        throw new Error("Check coverage and wait for the check to finish before acknowledging.");
      if (!data.coverageSnapshot?.exclusionDigest) throw new Error("Check Coverage sources first.");
      if (ctx.input.revision !== revision || data.coverageSnapshot.revision !== revision)
        throw new Error("Settings or the exclusion rule changed. Check coverage again before acknowledging.");
      if (ctx.input.exclusionDigest !== data.coverageSnapshot.exclusionDigest)
        throw new Error("The exclusion list changed. Reload Coverage sources and review it again.");
    }
    return { ...ctx.input, action, actor: dbUser.id };
  },
  run: async ctx => {
    const blocker = generationBlocker(ctx.wizard);
    if (blocker) throw new Error(blocker);
    const selected = readSelectedConfig(ctx.wizard)!;
    const plugin = resolvePlugin(selected.pluginId);
    if (!plugin.benefitSiriusIds?.length) return { data: { coverageReviewed: true } };
    const data = ctx.wizard.data as any;
    if (ctx.input.action === "acknowledge") {
      // Binds to the list on screen. Generate reads coverage again and
      // refuses unless what it would exclude is exactly this list.
      const snapshot = data.coverageSnapshot;
      if (!snapshot || snapshot.exclusionDigest !== ctx.input.exclusionDigest)
        throw new Error("The exclusion list changed. Check coverage again before acknowledging.");
      const acknowledgement: EdiCoverageAcknowledgement = {
        acknowledgedBy: String(ctx.input.actor ?? ""), acknowledgedAt: new Date().toISOString(),
        exclusionDigest: snapshot.exclusionDigest, exclusionCount: snapshot.exclusionCount, rule: snapshot.rule,
      };
      return { data: { coverageAcknowledgement: acknowledgement, coverageReviewed: true } };
    }
    const evidence = await readCoverageEvidence(buildEdiContext(ctx, selected), plugin, ctx.reportProgress);
    // Nothing excluded needs no acknowledgement; an earlier acknowledgement
    // of this exact list still stands.
    return { data: {
      coverageSnapshot: coverageSnapshot(evidence, data),
      coverageReviewed: !evidence.exclusions.length ||
        !!acknowledgementFor(data, evidence.exclusionDigest, evidence.rule),
    } };
  },
};

/** Generate from one bounded evidence read shared by every membership reader. */
const runStep: WizardStepHandler = {
  id: "run",
  name: "Generate",
  description: "Generate the EDI file rows",
  kind: "run",
  retrySafe: true,
  component: "RunView",
  getRunBlocker: generationBlocker,
  getState: (wizard) => {
    const data = (wizard.data as any) || {};
    const status = data.progress?.run?.status;
    if (status === "completed") return "completed";
    if (status === "failed") return "failed";
    if (status === "in_progress") return "in_progress";
    return "pending";
  },
  run: async (ctx) => {
    const blocker = generationBlocker(ctx.wizard);
    if (blocker) throw new Error(blocker);
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected) throw new Error("Pick an EDI configuration first");
    const plugin = resolvePlugin(selected.pluginId);
    const ediCtx = buildEdiContext(ctx, selected);

    // Invalidate the old description BEFORE replacing any rows. Keep concurrent
    // runner progress intact, and honor the run ownership fence when supplied.
    const invalidated = await ctx.storage.wizards.mergeData(
      ctx.wizardId, { reportMeta: null, recordCount: null, delivery: null },
      "run", ctx.runId,
    );
    if (!invalidated) throw new Error("EDI generation no longer owns this run");

    let evidence: CoverageEvidence | undefined;
    let acknowledgement: EdiCoverageAcknowledgement | null = null;
    if (plugin.benefitSiriusIds?.length) {
      evidence = await readCoverageEvidence(ediCtx, plugin, ctx.reportProgress);
      acknowledgement = acknowledgementFor(ctx.wizard.data, evidence.exclusionDigest, evidence.rule);
      // Leaving a member out of a replacement membership file can make the
      // carrier end their coverage, so an administrator accepts the exact list.
      if (evidence.exclusions.length && !acknowledgement)
        throw new Error(`This file would leave out ${evidence.exclusions.length} coverage record group(s) that no administrator has acknowledged, or the list changed since it was acknowledged. Check Coverage sources, review the exclusion list and acknowledge it, then generate again.`);
      ediCtx.coverageEvidence = evidence;
    }
    evidence?.budget.log("phase-start", "Reading generation keys");
    // The registry guarantees getPrimaryKeys (default filled at registration).
    const keys = await plugin.getPrimaryKeys!(ediCtx);
    evidence?.budget.check(keys.length);
    evidence?.budget.log("phase-end", "Reading generation keys");
    evidence?.budget.log("phase-start", "Generating file rows");
    await ctx.reportProgress(null, { phase: "Generating file rows" });
    const columns = plugin.getColumns();

    await ctx.storage.wizards.deleteReportData(ctx.wizardId);
    const BATCH = 100;
    let processed = 0;
    let saved = 0;
    const terminationCounts = { subscribers: 0, dependents: 0, inferred: 0 };
    const started = performance.now();
    for (let i = 0; i < keys.length; i += BATCH) {
      const batch = keys.slice(i, i + BATCH);
      const batchStarted = performance.now();
      evidence?.budget.log("phase-start", "Materializing generation batch", { processed, batchKeys: batch.length });
      const rows = await plugin.processBatch(batch, ediCtx);
      for (const row of rows) evidence?.budget.retain(row, false);
      evidence?.budget.log("phase-end", "Materializing generation batch", {
        milliseconds: Math.round(performance.now() - batchStarted), batchRows: rows.length,
      });
      evidence?.budget.log("phase-start", "Saving generation batch", { processed, batchRows: rows.length });
      const saveStarted = performance.now();
      for (const row of rows) {
        const pk = String(row.pk ?? "");
        if (!pk) continue;
        await ctx.storage.wizards.saveReportData(ctx.wizardId, pk, row);
        saved++;
        if (row.terminationRole === "subscriber") terminationCounts.subscribers++;
        if (row.terminationRole === "dependent") terminationCounts.dependents++;
        if (row.terminationEvidence === "coverage inferred") terminationCounts.inferred++;
      }
      for (const row of rows) evidence?.budget.release(row);
      evidence?.budget.log("phase-end", "Saving generation batch", {
        milliseconds: Math.round(performance.now() - saveStarted), batchRows: rows.length,
      });
      processed += batch.length;
      if (keys.length > 0) {
        await ctx.reportProgress(
          Math.min(99, Math.round((processed / keys.length) * 100)),
        );
      }
    }
    evidence?.budget.log("phase-end", "Generating file rows", { milliseconds: Math.round(performance.now() - started), rowsSaved: saved });

    let coverage: EdiCoverageRunSummary | null = null;
    if (evidence) {
      // The complete list travels with the run, however long it is.
      const entries: EdiCoverageEntry[] = [...evidence.exclusions, ...evidence.warnings];
      for (let i = 0; i < entries.length; i++)
        await ctx.storage.wizards.saveReportData(ctx.wizardId, `${COVERAGE_ENTRY_PK}${String(i).padStart(7, "0")}`, { coverageEntry: entries[i] });
      const expectedFingerprint = evidence.fingerprint;
      coverage = coverageSummary(evidence, acknowledgement);
      // No generation reader needs these maps after the rows and review list
      // have been saved. Do not hold two full evidence snapshots during the
      // final read; keep only the scalar fingerprint and summary.
      entries.length = 0;
      keys.length = 0;
      ediCtx.coverageEvidence = undefined;
      evidence = undefined;
      const fresh = await readCoverageEvidence(ediCtx, plugin,
        (percent, details) => ctx.reportProgress(percent, { ...details, phase: `Final evidence validation: ${details?.phase ?? ""}` }));
      if (fresh.fingerprint !== expectedFingerprint)
        throw new Error("Coverage evidence changed during generation. Check Coverage sources and regenerate; these rows are not available for delivery.");
    }
    return {
      status: "completed",
      data: {
        reportMeta: {
          generatedAt: new Date().toISOString(),
          recordCount: saved,
          columns,
          primaryKeyField: "pk",
          terminationCounts,
          coverage,
          terminationPolicy: plugin.benefitSiriusIds?.length ? ediCtx.terminationPolicy : null,
          generationContext: {
            input: ediCtx.input, configData: ediCtx.configData,
            terminationPolicy: ediCtx.terminationPolicy,
          },
        },
        recordCount: saved,
        delivery: null,
      },
    };
  },
};

/** Step 4 — standard results preview + CSV export. */
const resultsStep: WizardStepHandler = {
  id: "results",
  name: "Results",
  description: "Preview the generated records",
  kind: "results",
  component: "ResultsTable",
  // Both generic /data and /export use getData, so neither can read a partial
  // batch or stale report after failed regeneration.
  getData: async (ctx) => {
    if (!hasGeneratedReport(ctx.wizard)) {
      throw new Error("Complete EDI generation before viewing or exporting Results");
    }
    const reportMeta = (ctx.wizard.data as any).reportMeta;
    const rows = fileRows(await completedRows(ctx));
    return {
      reportMeta, columns: reportMeta.columns ?? [],
      records: rows.map(row => row.data),
      recordCount: reportMeta.recordCount ?? rows.length,
    };
  },
  getState: (wizard) => {
    return hasGeneratedReport(wizard) ? "completed" : "pending";
  },
};

async function encodeAllRows(
  ctx: WizardStepContext,
  plugin: TrustProviderEdiPlugin,
  ediCtx: TrustProviderEdiContext,
): Promise<{ content: string; rowCount: number }> {
  const rows = fileRows(await completedRows(ctx));
  const lines = assembleEdiFileLines(
    plugin,
    rows.map((r) => (r.data ?? {}) as Record<string, unknown>),
    ediCtx,
  );
  return {
    content: lines.join("\r\n") + (lines.length ? "\r\n" : ""),
    rowCount: rows.length,
  };
}

/** Step 5 — deliver the encoded file to the configured SFTP destination. */
const deliverStep: WizardStepHandler = {
  id: "deliver",
  name: "Deliver",
  description: "Send the encoded file to the configured SFTP destination",
  kind: "custom",
  component: "DeliverStep",
  exportFile: async (ctx, format) => {
    if (format !== "provider" && format !== "carrier-csv" && format !== "coverage-exclusions")
      throw new Error("Unknown EDI download format");
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected || !hasGeneratedReport(ctx.wizard)) {
      throw new Error("Generate the file before downloading it");
    }
    const plugin = resolvePlugin(selected.pluginId);
    const ediCtx = buildEdiContext(ctx, selected, true);
    const filename = plugin.buildFilename(ediCtx);
    if (format === "provider") {
      const { content } = await encodeAllRows(ctx, plugin, ediCtx);
      return { content, filename, mimeType: "text/plain; charset=utf-8" };
    }
    if (format === "coverage-exclusions") {
      // Built on request from what this generated run saved; never stored as a file.
      const summary = (ctx.wizard.data as any).reportMeta?.coverage as EdiCoverageRunSummary | null | undefined;
      if (!summary) throw new Error("This run was generated before exclusion lists were saved. Regenerate it to produce one.");
      return {
        content: coverageEntriesCsv(savedCoverageEntries(await completedRows(ctx)), summary.rule),
        filename: `${filename.replace(/\.[^.]+$/, "")}-coverage-exclusions.csv`,
        mimeType: "text/csv; charset=utf-8",
      };
    }
    const rows = fileRows(await completedRows(ctx));
    return {
      content: carrierLayoutCsv(plugin, rows.map(r => (r.data ?? {}) as Record<string, unknown>), ediCtx),
      filename: `${filename.replace(/\.[^.]+$/, "")}-carrier-layout-qa.csv`,
      mimeType: "text/csv; charset=utf-8",
    };
  },
  getState: (wizard) => {
    const data = (wizard.data as any) || {};
    if (data.delivery?.deliveredAt) return "completed";
    return data.reportMeta ? "in_progress" : "pending";
  },
  getData: async (ctx) => {
    const data = (ctx.wizard.data as any) || {};
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected || !hasGeneratedReport(ctx.wizard)) {
      return { ready: false, delivery: data.delivery ?? null };
    }
    const plugin = resolvePlugin(selected.pluginId);
    const ediCtx = buildEdiContext(ctx, selected, true);
    let destinationName: string | null = null;
    if (selected.sftpClientId) {
      const dest = await ctx.storage.sftpClientDestinations.getById(selected.sftpClientId);
      destinationName = dest?.name ?? null;
    }
    return {
      ready: true,
      filename: plugin.buildFilename(ediCtx),
      rowCount: data.reportMeta.recordCount,
      terminationCounts: data.reportMeta.terminationCounts ?? null,
      // What this file leaves out, shown before anyone sends it.
      coverage: (data.reportMeta.coverage as EdiCoverageRunSummary | undefined) ?? null,
      destinationId: selected.sftpClientId,
      destinationName,
      delivery: data.delivery ?? null,
    };
  },
  submit: async (ctx) => {
    const data = (ctx.wizard.data as any) || {};
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected || !hasGeneratedReport(ctx.wizard)) {
      throw new Error("Generate the file before delivering it");
    }
    if (!selected.sftpClientId) {
      throw new Error(
        "The selected EDI configuration has no SFTP destination — set one on the configuration to deliver.",
      );
    }
    const plugin = resolvePlugin(selected.pluginId);
    const ediCtx = buildEdiContext(ctx, selected, true);
    const { content, rowCount } = await encodeAllRows(ctx, plugin, ediCtx);
    if (!rowCount) throw new Error("There are no records to deliver");

    const destination = await ctx.storage.sftpClientDestinations.getById(
      selected.sftpClientId,
    );
    if (!destination) throw new Error("SFTP destination not found");
    const { connectionDataSchema } = await import(
      "@shared/schema/system/sftp-client-schema"
    );
    const parsed = connectionDataSchema.safeParse(destination.data ?? {});
    if (!parsed.success) {
      throw new Error("SFTP destination connection settings are incomplete");
    }
    const conn = parsed.data;
    const filename = plugin.buildFilename(ediCtx);
    const { testUpload } = await import("../../../services/file-transfer-client");
    const result = await testUpload(
      conn,
      conn.homeDir || "/",
      filename,
      Buffer.from(content, "utf-8"),
      destination.id,
    );
    if (!result.success) {
      throw new Error(result.error || "SFTP upload failed");
    }

    const { getEffectiveUser } = await import("../../../modules/masquerade");
    const { dbUser } = await getEffectiveUser(
      (ctx.req as any).session,
      (ctx.req as any).user,
    );
    return {
      status: "completed",
      data: {
        delivery: {
          deliveredAt: new Date().toISOString(),
          deliveredBy: dbUser?.id ?? null,
          filename,
          rowCount,
          destinationId: destination.id,
          destinationName: destination.name,
        },
      },
    };
  },
};

export const trustProviderEdiWizardPlugin: WizardPlugin = {
  id: WIZARD_ID,
  name: "Trust Provider EDI File",
  description:
    "Generate a provider EDI file from a configured EDI file type, preview the records, and deliver the encoded file via SFTP.",
  requiredComponent: COMPONENT,
  requiredPolicy: "admin",
  category: "Trust",
  isReport: true,
  needsReadOnlyDb: true,
  create: async ({ input, storage }) => ({
    wizard: await storage.wizards.create({
      ...input,
      status: String(input.status ?? "draft"),
      data: { terminationPolicy: { ...newRunTerminationPolicy } },
    } as InsertWizard),
  }),
  prepareUpdate: ({ incoming, merged }) => Object.keys(incoming).every(key => key === "retention")
    ? { data: merged }
    : { error: "Use the EDI wizard steps to change saved settings.", status: 400 },
  steps: [configStep, paramsStep, coverageStep, runStep, resultsStep, deliverStep],
};

registerWizardPlugin(trustProviderEdiWizardPlugin);
