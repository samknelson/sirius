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
import { discoverCoverage, coverageProjection } from "../../trust/provider-edi/coverage-review";
import { approveConflict, evidenceHash, releaseCoverageProjectionIndex } from "../../trust/provider-edi/coverage-choices";
import type { EdiCoverageDecision } from "@shared/edi-coverage-choices";

/**
 * The single trust-provider EDI wizard. Generation, preview, and SFTP
 * delivery of EDI files are generic; the file's contents and encoding are
 * deferred to the EDI plugin named by the configuration picked in the
 * first step. Gated by the same component as the plugin kind.
 *
 * Wizard data shape:
 * - `config`  — { configId, pluginId, name, providerId, sftpClientId, data }
 * - `input`   — parameter-step values (validated against plugin.inputSchema)
 * - `reportMeta` / rows in wizard_report_data — standard report machinery
 * - `delivery`— { deliveredAt, deliveredBy, filename, rowCount, destinationId, destinationName }
 */

const WIZARD_ID = "trust_provider_edi";
const COMPONENT = "trust.providers.edi";

function assertReviewSize(snapshot: unknown) {
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2_000_000)
    throw new Error("Coverage review is too large to display safely. Correct competing source records and refresh evidence.");
}

function coverageRevision(data: any) {
  return evidenceHash({
    config: data.config, input: data.input, terminationPolicy: data.terminationPolicy,
    decisions: data.coverageDecisions ?? [],
  });
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
    coverageDecisions: [],
    coverageReviewed: false,
    coverageSnapshot: null,
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
  description: "Review competing coverage and select sources for this run only",
  kind: "custom",
  component: "CoverageSources",
  requiredPolicy: "admin",
  requiredComponent: COMPONENT,
  retrySafe: true,
  getRunBlocker: generationBlocker,
  getState: wizard => (wizard.data as any)?.coverageReviewed === true ? "completed" : "pending",
  getData: async ctx => {
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected) throw new Error("Pick Configuration and save Parameters first.");
    const plugin = resolvePlugin(selected.pluginId);
    if (!plugin.benefitSiriusIds?.length) return { applicable: false, conflicts: [], decisionsUsed: [] };
    const blocker = generationBlocker(ctx.wizard);
    if (blocker) throw new Error(blocker);
    const data = ctx.wizard.data as any;
    return { applicable: true, ...data.coverageSnapshot, conflicts: data.coverageSnapshot?.conflicts ?? [],
      ready: !!data.coverageSnapshot && data.coverageSnapshot.revision === coverageRevision(data) &&
        data.progress?.coverage?.status === "completed",
      decisionsUsed: hasGeneratedReport(ctx.wizard) ? data.reportMeta?.coverageDecisions ?? [] : [] };
  },
  prepareRun: async ctx => {
    const action = ctx.input.action ?? "check";
    if (!["check", "complete", "decision"].includes(String(action))) throw new Error("Unknown coverage action.");
    const { getEffectiveUser } = await import("../../../modules/masquerade");
    const { dbUser } = await getEffectiveUser((ctx.req as any).session, (ctx.req as any).user);
    if (!dbUser?.id) throw new Error("An effective administrator is required.");
    const selected = readSelectedConfig(ctx.wizard);
    if (action !== "check" && selected && resolvePlugin(selected.pluginId).benefitSiriusIds?.length) {
      const data = ctx.wizard.data as any;
      const revision = coverageRevision(data);
      if (!data.coverageSnapshot) throw new Error("Check Coverage sources first.");
      if (ctx.input.revision !== revision || data.coverageSnapshot.revision !== revision)
        throw new Error("Settings or decisions changed. Refresh evidence before submitting this action.");
    }
    return { ...ctx.input, action, actor: dbUser.id };
  },
  run: async ctx => {
    const blocker = generationBlocker(ctx.wizard);
    if (blocker) throw new Error(blocker);
    const selected = readSelectedConfig(ctx.wizard)!;
    const plugin = resolvePlugin(selected.pluginId);
    if (!plugin.benefitSiriusIds?.length) return { data: { coverageReviewed: true } };
    const decisions: EdiCoverageDecision[] = (ctx.wizard.data as any)?.coverageDecisions ?? [];
    const review = await discoverCoverage(buildEdiContext(ctx, selected), plugin, decisions, ctx.reportProgress);
    const snapshot = { conflicts: review.conflicts, fingerprint: review.fingerprint, revision: coverageRevision(ctx.wizard.data) };
    // Bound the saved review, never the historical evidence used to establish it.
    assertReviewSize(snapshot);
    if (ctx.input.action === "complete") {
      if (ctx.input.fingerprint !== review.fingerprint)
        throw new Error("Coverage evidence changed. Refresh evidence before completing review.");
      coverageProjection(review);
      return { data: { coverageSnapshot: snapshot, coverageReviewed: true } };
    }
    if (ctx.input.action === "decision") {
      if (ctx.input.fingerprint !== review.fingerprint)
        throw new Error("Coverage evidence changed. Refresh evidence before saving a decision.");
      const conflict = review.conflicts.find(c => c.key === ctx.input.key);
      if (!conflict) throw new Error("This conflict no longer exists. Refresh Coverage sources.");
      const decision = approveConflict(conflict, ctx.input, String(ctx.input.actor ?? ""), new Date().toISOString());
      conflict.decision = decision;
      conflict.stale = false;
      const updatedDecisions = [...decisions.filter(d => d.key !== decision.key), decision];
      snapshot.revision = coverageRevision({ ...(ctx.wizard.data as any), coverageDecisions: updatedDecisions });
      assertReviewSize(snapshot);
      return { status: "draft", data: {
        reportMeta: null, recordCount: null, delivery: null, coverageReviewed: false,
        coverageSnapshot: snapshot,
        coverageDecisions: updatedDecisions,
      } };
    }
    return { data: { coverageSnapshot: snapshot, coverageReviewed: false } };
  },
};

/** Generate using one run-only projection across every membership reader. */
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

    if (plugin.benefitSiriusIds?.length) {
      const review = await discoverCoverage(ediCtx, plugin, (ctx.wizard.data as any)?.coverageDecisions ?? [], ctx.reportProgress);
      ediCtx.coverageProjection = coverageProjection(review);
    }
    // The registry guarantees getPrimaryKeys (default filled at registration).
    const keys = await plugin.getPrimaryKeys!(ediCtx);
    await ctx.reportProgress(null, { phase: "Generating file rows" });
    const columns = plugin.getColumns();

    await ctx.storage.wizards.deleteReportData(ctx.wizardId);
    const BATCH = 100;
    let processed = 0;
    let saved = 0;
    const terminationCounts = { subscribers: 0, dependents: 0, inferred: 0 };
    for (let i = 0; i < keys.length; i += BATCH) {
      const batch = keys.slice(i, i + BATCH);
      const rows = await plugin.processBatch(batch, ediCtx);
      for (const row of rows) {
        const pk = String(row.pk ?? "");
        if (!pk) continue;
        await ctx.storage.wizards.saveReportData(ctx.wizardId, pk, row);
        saved++;
        if (row.terminationRole === "subscriber") terminationCounts.subscribers++;
        if (row.terminationRole === "dependent") terminationCounts.dependents++;
        if (row.terminationEvidence === "coverage inferred") terminationCounts.inferred++;
      }
      processed += batch.length;
      if (keys.length > 0) {
        await ctx.reportProgress(
          Math.min(99, Math.round((processed / keys.length) * 100)),
        );
      }
    }

    if (ediCtx.coverageProjection) {
      releaseCoverageProjectionIndex(ediCtx.coverageProjection);
      const fresh = await discoverCoverage(ediCtx, plugin, ediCtx.coverageProjection.decisions,
        (percent, details) => ctx.reportProgress(percent, { ...details, phase: `Final evidence validation: ${details?.phase ?? ""}` }));
      const checked = coverageProjection(fresh);
      if (checked.fingerprint !== ediCtx.coverageProjection.fingerprint)
        throw new Error("Coverage evidence changed during generation. Review Coverage sources and regenerate; these rows are not available for delivery.");
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
          coverageDecisions: ediCtx.coverageProjection?.decisions ?? [],
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
    const rows = await completedRows(ctx);
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
  const rows = await completedRows(ctx);
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
    if (format !== "provider" && format !== "carrier-csv") throw new Error("Unknown EDI download format");
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
    const rows = await completedRows(ctx);
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
      data: { terminationPolicy: { ...newRunTerminationPolicy }, coverageDecisions: [] },
    } as InsertWizard),
  }),
  prepareUpdate: ({ incoming, merged }) => Object.keys(incoming).every(key => key === "retention")
    ? { data: merged }
    : { error: "Use the EDI wizard steps to change saved settings.", status: 400 },
  steps: [configStep, paramsStep, coverageStep, runStep, resultsStep, deliverStep],
};

registerWizardPlugin(trustProviderEdiWizardPlugin);
