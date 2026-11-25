import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Non-secret compare token, not a public address or credential. */
export function wcConfigurationRevision(config: { id: string; pluginId: string; data: unknown }): string {
  return createHash("sha256").update(canonical([config.id, config.pluginId, config.data])).digest("hex");
}
