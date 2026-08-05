import { logger } from "../../../logger";
import { wmbPrimaryKeys } from "./base";
import { PluginRegistry, isPluginComponentEnabledSync } from "../../_core";
import type { BasePluginMetadata } from "../../_core";
import type { JsonSchema } from "@shared/json-schema-form";
import type { storage as storageType } from "../../../storage";

/**
 * Context handed to an EDI plugin's data functions. Everything the plugin
 * needs is here: the resolved config (base + subsidiary + data blob), the
 * wizard's parameter-step input, and the storage facade.
 */
/** Batch aggregates handed to header/trailer hooks. */
export interface EdiBatchAggregates {
  /** Number of detail records in the file (excludes header/trailer/CSV header). */
  detailRecordCount: number;
  /**
   * The persisted detail rows in file order, so trailers can compute
   * row-derived aggregates (e.g. Dentwell's subscriber/dependent counts).
   */
  detailRows: ReadonlyArray<Record<string, unknown>>;
}

export interface TrustProviderEdiContext {
  /** Base plugin_configs row id of the selected EDI configuration. */
  configId: string;
  /** The config's `data` blob (per-type variables, e.g. region code). */
  configData: Record<string, unknown>;
  /** Subsidiary columns of the selected config. */
  providerId: string | null;
  sftpClientId: string | null;
  /** Wizard parameter-step input (validated against `inputSchema`). */
  input: Record<string, unknown>;
  storage: typeof storageType;
}

/**
 * A trust-provider EDI file type. Each plugin defines the full lifecycle
 * of one EDI file format: which records go in the file (`getPrimaryKeys` +
 * `processBatch`), what the preview table looks like (`getColumns`), and
 * how a row is serialized into the delivered file (`encodeRow` +
 * `buildFilename`). The generation/preview/delivery machinery lives in the
 * single `trust_provider_edi` wizard, which defers to the plugin named by
 * the selected configuration.
 */
export interface TrustProviderEdiPlugin extends BasePluginMetadata {
  /** JSON Schema for per-config variables stored in the config `data` blob. */
  configSchema?: JsonSchema;
  /** JSON Schema for wizard run parameters (e.g. as-of date). */
  inputSchema?: JsonSchema;
  /**
   * Sirius IDs of the trust benefit(s) whose monthly benefit records define
   * file membership. When set (and `getPrimaryKeys` is not overridden), the
   * registry supplies the default wmb-driven `getPrimaryKeys`. A config-level
   * `benefitSiriusId` data value still overrides these defaults per config.
   */
  benefitSiriusIds?: readonly string[];
  /** Columns for the wizard results preview table (and CSV export). */
  getColumns(): Array<{ id: string; header: string; type?: string; width?: number }>;
  /**
   * List every record key that belongs in the file. Optional when
   * `benefitSiriusIds` is declared — the default wmb membership is used.
   */
  getPrimaryKeys?(ctx: TrustProviderEdiContext): Promise<string[]>;
  /**
   * Materialize a batch of keys into row objects. Each row must carry its
   * key under `pk`; rows are persisted to `wizard_report_data`.
   */
  processBatch(
    keys: string[],
    ctx: TrustProviderEdiContext,
  ): Promise<Array<Record<string, unknown>>>;
  /**
   * Output format of the delivered file. Default "fixed-width". CSV plugins
   * should build rows with the `EdiCsvField`/`encodeCsvRow` helpers and get
   * an automatic column-header row (see `csvIncludeHeaderRow`).
   */
  outputFormat?: "fixed-width" | "csv";
  /**
   * CSV only: emit a column-header row before the detail rows (default
   * true). Set false to suppress it (e.g. Carelon).
   */
  csvIncludeHeaderRow?: boolean;
  /**
   * CSV only: the column-header line (no newline), typically
   * `encodeCsvHeaderRow(fields)`. Required when `outputFormat` is "csv"
   * and the header row is not suppressed.
   */
  encodeCsvHeaderRow?(ctx: TrustProviderEdiContext): string;
  /**
   * Optional file-level header record(s) emitted before everything else
   * (before the CSV column-header row, when both are present). Receives
   * batch aggregates (record counts) plus the run context (config data,
   * wizard input). Return null/undefined for no header.
   */
  encodeFileHeader?(
    ctx: TrustProviderEdiContext,
    aggregates: EdiBatchAggregates,
  ): string | string[] | null | undefined;
  /**
   * Optional file-level trailer record(s) emitted after all detail rows
   * (e.g. record counts, file date, production/test indicator).
   */
  encodeFileTrailer?(
    ctx: TrustProviderEdiContext,
    aggregates: EdiBatchAggregates,
  ): string | string[] | null | undefined;
  /** Serialize one persisted row into one line of the output file (no newline). */
  encodeRow(row: Record<string, unknown>, ctx: TrustProviderEdiContext): string;
  /** Name of the delivered file (e.g. `KAISER_20260801.txt`). */
  buildFilename(ctx: TrustProviderEdiContext): string;
}

/** Manifest entry served by the generic /api/plugins/:kind/manifest route. */
export interface TrustProviderEdiPluginMetadata extends BasePluginMetadata {
  componentId: string;
  componentEnabled: boolean;
  configSchema?: JsonSchema;
}

function pluginToMetadata(p: TrustProviderEdiPlugin): BasePluginMetadata {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
    hidden: p.hidden,
  };
}

function pluginToManifestEntry(
  p: TrustProviderEdiPlugin,
): TrustProviderEdiPluginMetadata {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
    componentId: p.requiredComponent ?? "",
    componentEnabled: isPluginComponentEnabledSync(p),
    configSchema: p.configSchema,
  };
}

class TrustProviderEdiPluginRegistry extends PluginRegistry<
  TrustProviderEdiPlugin,
  TrustProviderEdiPluginMetadata
> {
  constructor() {
    super({
      kind: "trust-provider-edi",
      getMetadata: pluginToMetadata,
      toManifestEntry: pluginToManifestEntry,
      allowOverwrite: true,
    });
  }

  register(plugin: TrustProviderEdiPlugin): void {
    if (!plugin.getPrimaryKeys) {
      const siriusIds = plugin.benefitSiriusIds;
      if (!siriusIds?.length) {
        throw new Error(
          `Trust provider EDI plugin '${plugin.id}' must declare benefitSiriusIds or implement getPrimaryKeys.`,
        );
      }
      plugin.getPrimaryKeys = (ctx) => wmbPrimaryKeys(ctx, siriusIds);
    }
    super.register(plugin);
    logger.info(`Trust provider EDI plugin registered: ${plugin.id}`, {
      service: "trust-provider-edi-registry",
    });
  }
}

export const trustProviderEdiPluginRegistry = new TrustProviderEdiPluginRegistry();

/** Self-registration helper used by individual plugin files. */
export function registerTrustProviderEdiPlugin(plugin: TrustProviderEdiPlugin): void {
  trustProviderEdiPluginRegistry.register(plugin);
}
