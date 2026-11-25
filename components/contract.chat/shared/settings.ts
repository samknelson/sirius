/** Explicit saved configuration choice, not a vendor plugin or automatic default. */
export const CONTRACT_CHAT_SETTINGS_VARIABLE = "contract_chat_settings";

export interface ContractChatSettings {
  providerConfigId: string | null;
}

export const CONTRACT_CHAT_OPERATIONS = [
  "contract.chat.catalog",
  "contract.chat.ask",
  "contract.chat.search",
  "contract.chat.route",
  "contract.chat.feedback",
] as const;

type ParsedSettings =
  | { valid: true; settings: ContractChatSettings }
  | { valid: false; error: string };

/**
 * The core variable hook represents a missing row as null. Do not coerce
 * malformed values (including serialized JSON) into an apparently empty choice.
 */
export function parseContractChatSettings(value: unknown): ParsedSettings {
  if (value === null || value === undefined) {
    return { valid: true, settings: { providerConfigId: null } };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const id = record.providerConfigId;
    if (
      Object.keys(record).length === 1 &&
      (id === null || (typeof id === "string" && id.trim().length > 0))
    ) {
      return { valid: true, settings: { providerConfigId: id } };
    }
  }
  return {
    valid: false,
    error: "Saved Contract Chat settings are malformed. Explicitly select a provider or clear the setting before saving a replacement.",
  };
}
