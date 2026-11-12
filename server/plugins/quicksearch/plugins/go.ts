import { authorizeRecordGoUser } from "../../../services/record-go-access";
import { resolveRecordGoIdentifier, presentRecordGo } from "../../../services/record-go";
import { registerQuicksearchPlugin } from "../registry";
import type { QuicksearchPlugin, QuicksearchPluginResult } from "../types";

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

    const presentation = presentRecordGo(resolution);
    if (!presentation) return [];

    return [
      {
        ...presentation,
        matchedOn: "Record identifier",
      },
    ];
  },
};

registerQuicksearchPlugin(goQuicksearchPlugin);
