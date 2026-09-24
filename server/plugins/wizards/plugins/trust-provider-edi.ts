import { registerWizardPlugin } from "../registry";
import type { WizardPlugin, WizardStepContext, WizardStepHandler } from "../types";
import type { Wizard } from "@shared/schema";
import {
  trustProviderEdiPluginRegistry,
  type TrustProviderEdiContext,
  type TrustProviderEdiPlugin,
} from "../../trust/provider-edi/registry";

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

function buildEdiContext(
  ctx: WizardStepContext,
  selected: SelectedConfig,
): TrustProviderEdiContext {
  const data = (ctx.wizard.data as any) || {};
  return {
    configId: selected.configId,
    configData: selected.data ?? {},
    providerId: selected.providerId,
    sftpClientId: selected.sftpClientId,
    input: (data.input ?? {}) as Record<string, unknown>,
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
      data: {
        config: selected,
        input: null,
        reportMeta: null,
        recordCount: null,
        delivery: null,
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
  getSchema: (wizard) => {
    const selected = readSelectedConfig(wizard);
    if (!selected) return { type: "object", properties: {} };
    const plugin = trustProviderEdiPluginRegistry.get(selected.pluginId);
    return plugin?.inputSchema ?? { type: "object", properties: {} };
  },
  getState: (wizard) => {
    const data = (wizard.data as any) || {};
    return data.input ? "completed" : "pending";
  },
  submit: (ctx) => ({ data: { input: ctx.input ?? {} } }),
};

/** Step 3 — generate: defer keys + batches to the EDI plugin. */
const runStep: WizardStepHandler = {
  id: "run",
  name: "Generate",
  description: "Generate the EDI file rows",
  kind: "run",
  component: "RunView",
  getState: (wizard) => {
    const data = (wizard.data as any) || {};
    const status = data.progress?.run?.status;
    if (status === "completed") return "completed";
    if (status === "failed") return "failed";
    if (status === "in_progress") return "in_progress";
    return "pending";
  },
  run: async (ctx) => {
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected) throw new Error("Pick an EDI configuration first");
    const plugin = resolvePlugin(selected.pluginId);
    const ediCtx = buildEdiContext(ctx, selected);

    // The registry guarantees getPrimaryKeys (default filled at registration).
    const keys = await plugin.getPrimaryKeys!(ediCtx);
    const columns = plugin.getColumns();

    await ctx.storage.wizards.deleteReportData(ctx.wizardId);
    const BATCH = 100;
    let processed = 0;
    let saved = 0;
    for (let i = 0; i < keys.length; i += BATCH) {
      const batch = keys.slice(i, i + BATCH);
      const rows = await plugin.processBatch(batch, ediCtx);
      for (const row of rows) {
        const pk = String(row.pk ?? "");
        if (!pk) continue;
        await ctx.storage.wizards.saveReportData(ctx.wizardId, pk, row);
        saved++;
      }
      processed += batch.length;
      if (keys.length > 0) {
        await ctx.reportProgress(
          Math.min(99, Math.round((processed / keys.length) * 100)),
        );
      }
    }

    return {
      status: "completed",
      data: {
        reportMeta: {
          generatedAt: new Date().toISOString(),
          recordCount: saved,
          columns,
          primaryKeyField: "pk",
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
  getState: (wizard) => {
    const data = (wizard.data as any) || {};
    return data.reportMeta ? "completed" : "pending";
  },
};

async function encodeAllRows(
  ctx: WizardStepContext,
  plugin: TrustProviderEdiPlugin,
  ediCtx: TrustProviderEdiContext,
): Promise<{ content: string; rowCount: number }> {
  const rows = await ctx.storage.wizards.getReportData(ctx.wizardId);
  const lines = rows.map((r) =>
    plugin.encodeRow((r.data ?? {}) as Record<string, unknown>, ediCtx),
  );
  return { content: lines.join("\r\n") + (lines.length ? "\r\n" : ""), rowCount: lines.length };
}

/** Step 5 — deliver the encoded file to the configured SFTP destination. */
const deliverStep: WizardStepHandler = {
  id: "deliver",
  name: "Deliver",
  description: "Send the encoded file to the configured SFTP destination",
  kind: "custom",
  component: "DeliverStep",
  getState: (wizard) => {
    const data = (wizard.data as any) || {};
    if (data.delivery?.deliveredAt) return "completed";
    return data.reportMeta ? "in_progress" : "pending";
  },
  getData: async (ctx) => {
    const data = (ctx.wizard.data as any) || {};
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected || !data.reportMeta) {
      return { ready: false, delivery: data.delivery ?? null };
    }
    const plugin = resolvePlugin(selected.pluginId);
    const ediCtx = buildEdiContext(ctx, selected);
    const { content, rowCount } = await encodeAllRows(ctx, plugin, ediCtx);
    let destinationName: string | null = null;
    if (selected.sftpClientId) {
      const dest = await ctx.storage.sftpClientDestinations.getById(selected.sftpClientId);
      destinationName = dest?.name ?? null;
    }
    return {
      ready: true,
      filename: plugin.buildFilename(ediCtx),
      rowCount,
      content,
      destinationId: selected.sftpClientId,
      destinationName,
      delivery: data.delivery ?? null,
    };
  },
  submit: async (ctx) => {
    const data = (ctx.wizard.data as any) || {};
    const selected = readSelectedConfig(ctx.wizard);
    if (!selected || !data.reportMeta) {
      throw new Error("Generate the file before delivering it");
    }
    if (!selected.sftpClientId) {
      throw new Error(
        "The selected EDI configuration has no SFTP destination — set one on the configuration to deliver.",
      );
    }
    const plugin = resolvePlugin(selected.pluginId);
    const ediCtx = buildEdiContext(ctx, selected);
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
  steps: [configStep, paramsStep, runStep, resultsStep, deliverStep],
};

registerWizardPlugin(trustProviderEdiWizardPlugin);
