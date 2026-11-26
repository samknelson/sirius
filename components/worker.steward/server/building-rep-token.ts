import { contacts } from "@shared/schema";
import { registerTokenPlugin } from "../../../server/plugins/tokens/registry";
import { memo, tokenEntityOf, type TokenEntity } from "../../../server/plugins/tokens/types";
import { getBuildingRepContactRow } from "./storage/building-rep";
registerTokenPlugin({
  metadata: {
    id: "token.worker.building_rep", name: "Building rep",
    description: "Contact of the steward for this worker's bargaining unit and employer",
    segmentName: "building_rep", inputTypes: ["worker"], outputType: "contact",
    entityTable: contacts, requiredComponent: "worker.steward",
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    if (!w) return null;
    const buId = w.row.bargainingUnitId;
    const employerId = w.row.homeEmployerId ??
      (Array.isArray(w.row.employerIds) ? w.row.employerIds[0] : null) ?? null;
    if (typeof employerId !== "string" || typeof buId !== "string") return null;
    const workerId = typeof w.row.id === "string" ? w.row.id : null;
    const row = await memo(ctx, `building-rep:${employerId}:${buId}:${workerId}`,
      async () => (await getBuildingRepContactRow(employerId, buId, workerId)) ?? null);
    if (!row) return null;
    const out: TokenEntity = { kind: "contact", row, table: contacts };
    return out;
  },
});
