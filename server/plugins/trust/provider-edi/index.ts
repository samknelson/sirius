import { z } from "zod";
import { logger } from "../../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
import { trustProviderEdiPluginRegistry } from "./registry";

export {
  trustProviderEdiPluginRegistry,
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiPlugin,
  type TrustProviderEdiContext,
  type EdiBatchAggregates,
} from "./registry";

let kindRegistered = false;
function registerTrustProviderEdiKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "trust-provider-edi",
    registry: trustProviderEdiPluginRegistry,
    label: "Trust Provider EDI",
    description:
      "EDI file types generated for trust providers and delivered via SFTP. " +
      "Each configuration pairs a file-type plugin with a provider and an " +
      "SFTP destination.",
    requiredComponent: "trust.providers.edi",
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
    validateConfig: async (plugin, config) => {
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import("../../../lib/json-schema-validator");
      const result = validateAgainstSchema(plugin.configSchema, config);
      if (result.valid) return { valid: true };
      return { valid: false, errors: result.errors ?? ["Invalid configuration"] };
    },
  });
  registerPluginConfigAdapter({
    pluginKind: "trust-provider-edi",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      providerId: z.string().nullable().optional(),
      sftpClientId: z.string().nullable().optional(),
    }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
      providerId: z.string().nullable().optional(),
      sftpClientId: z.string().nullable().optional(),
    }),
    toRows: (input) => ({
      base: {
        pluginKind: "trust-provider-edi",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
      subsidiary: {
        providerId: input.providerId ?? null,
        sftpClientId: input.sftpClientId ?? null,
      },
    }),
    envelopeFields: [
      {
        // NOTE: organizational label only — which provider this file belongs
        // to. It does NOT filter file membership (no provider→benefit
        // relation exists); each plugin defines membership from its own
        // config (e.g. Kaiser's benefitSiriusId).
        name: "providerId",
        label: "Provider (label only — does not filter members)",
        type: "string",
        filterable: true,
        options: {
          endpoint: "/api/trust/providers",
          valueKey: "id",
          labelKey: "name",
        },
      },
      {
        name: "sftpClientId",
        label: "SFTP Destination",
        type: "string",
        filterable: true,
        options: {
          endpoint: "/api/sftp/client-destinations",
          valueKey: "id",
          labelKey: "name",
        },
      },
    ],
  });
  kindRegistered = true;
}

/**
 * Initialize the trust-provider EDI plugin system: registers the plugin
 * kind + config adapter (admin config UI and generic plugin routes), then
 * loads the file-type plugins via the side-effect imports at the bottom.
 * To add a new EDI file type: drop a file under `./plugins/` and add one
 * `import "./plugins/<name>"` line below.
 */
export function initializeTrustProviderEdiSystem(): void {
  registerTrustProviderEdiKind();
  logger.info("Trust provider EDI plugins registered", {
    service: "trust-provider-edi-plugins",
    plugins: trustProviderEdiPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/sitespecific-bao-kaiser";
import "./plugins/sitespecific-bao-healthnet";
import "./plugins/sitespecific-smf-local11";
import "./plugins/sitespecific-smf-hinge";
import "./plugins/sitespecific-smf-dentwell";
import "./plugins/sitespecific-smf-mlk";
import "./plugins/sitespecific-smf-carelon";
