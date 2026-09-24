import { getMetadataRecordContext } from "../../../storage/entity-metadata-record-tables";
import { authorizeRecordGoUser } from "../../../services/record-go-access";
import { resolveRecordGoIdentifier } from "../../../services/record-go";
import { formatRecordRevision, formatRecordSequence } from "@shared/utils/record-sequence";
import { registerQuicksearchPlugin } from "../registry";
import type { QuicksearchPlugin, QuicksearchPluginResult } from "../types";

function formatRecordMetadata(seq: number, rev: number): string {
  return `${formatRecordSequence(seq)}::${formatRecordRevision(rev)}`;
}

export const goQuicksearchPlugin: QuicksearchPlugin = {
  id: "go",
  name: "Go",
  description:
    "Go to a record by its ID, metadata ID, record sequence, or copied record badge.",
  icon: "search",

  async search(ctx): Promise<QuicksearchPluginResult[]> {
    const resolution = await resolveRecordGoIdentifier(ctx.query);
    if (resolution.kind !== "resolved") return [];
    if (!(await authorizeRecordGoUser(ctx.user, resolution))) return [];

    const context = getMetadataRecordContext(resolution.metadata.contextId);
    if (!context) return [];

    return [
      {
        id: resolution.metadata.entityId,
        title: context.label,
        subtitle: formatRecordMetadata(resolution.metadata.seq, resolution.metadata.rev),
        href: resolution.href,
        matchedOn: "Record identifier",
      },
    ];
  },
};

registerQuicksearchPlugin(goQuicksearchPlugin);
