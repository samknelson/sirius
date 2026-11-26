import type { PluginConfigSubsidiaryDescriptor } from "../../../server/storage/system/plugin-configs-subsidiary";
import { createTrustProviderEdiSubsidiaryStorage } from "./storage/plugin-configs";
export const pluginConfigSubsidiaries = [
  { kind: "trust-provider-edi", create: createTrustProviderEdiSubsidiaryStorage },
] satisfies readonly PluginConfigSubsidiaryDescriptor[];
export function createStorage() { return {}; }
