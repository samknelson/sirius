import { z } from "zod";
import { storage } from "../../../../../../../server/storage";
import { EventType, type EntityNoteChangedPayload } from "../../../../../../../server/services/event-bus";
import { isPluginComponentEnabledSync } from "../../../../../../../server/plugins/_core/gating";
import { registerDenormPlugin } from "../../../../../../../server/plugins/system/denorm/registry";
import type { DenormPlugin } from "../../../../../../../server/plugins/system/denorm/types";
import type { BadgeGrantState, NoteBadgeGrant } from "../../../../storage/system/worker-badges-denorm";
import { getRequestContext } from "../../../../../../../server/middleware/request-context";
import { onAfterCommit } from "../../../../../../../server/storage/transaction-context";
import { broadcastBadgeGrant } from "../../../../../../../server/services/websocket";

const ruleSchema = z.object({
  noteTypeId: z.string().min(1),
  badgeTypeId: z.string().min(1),
}).strict();

const plugin: DenormPlugin<NoteBadgeGrant | null, BadgeGrantState | undefined> = {
  metadata: {
    id: "workerBadgeFromNote",
    name: "Worker Badge From Note",
    description: "Grants a worker badge from a qualifying note; removal follows the note's denorm lifecycle.",
    requiredComponent: "worker.badges",
    singleton: false,
  },
  entityType: "entity_note",
  replaceOnCompute: true,
  reads: ["workerBadgesDenorm"],
  writes: [{ storage: "workerBadgesDenorm", soleWriter: true }],
  configSchema: {
    type: "object",
    properties: {
      noteTypeId: {
        type: "string", minLength: 1, title: "Note type",
        description: "Select a note type that applies to Workers.",
        "x-options-resource": "note-type",
      },
      badgeTypeId: {
        type: "string", minLength: 1, title: "Badge type",
        "x-options-resource": "worker-badge-type",
      },
    },
    required: ["noteTypeId", "badgeTypeId"],
    additionalProperties: false,
  },
  async validateConfig(data) {
    if (!isPluginComponentEnabledSync(plugin.metadata)) {
      return { valid: false, errors: ["Worker Badges is not enabled."] };
    }
    const parsed = ruleSchema.safeParse(data);
    if (!parsed.success) return { valid: false, errors: ["Select a note type and a badge type."] };
    const errors = await storage.workerBadgesDenorm.validateNoteRule(parsed.data);
    return errors.length ? { valid: false, errors } : { valid: true };
  },
  eventHandlers: [EventType.ENTITY_NOTE_SAVE_AFTER, EventType.ENTITY_NOTE_DELETE_AFTER].map(event => ({
    event,
    getEntityId: payload => (payload as EntityNoteChangedPayload).noteId,
  })),
  async compute(noteId, config) {
    const rule = ruleSchema.parse(config?.data);
    const note = await storage.workerBadgesDenorm.getQualifyingNote(noteId, rule);
    return note ? {
      workerId: note.entityId,
      badgeTypeId: rule.badgeTypeId,
      grantedTimestamp: note.timestamp,
    } : null;
  },
  async beforeApply(_noteId, grant) {
    return grant ? storage.workerBadgesDenorm.getGrantState(grant) : undefined;
  },
  async write(_noteId, grant, denormId, before) {
    if (!grant) return;
    const inserted = await storage.workerBadgesDenorm.insertGrant(denormId, grant);
    const userId = getRequestContext()?.userId;
    if (inserted && before && !before.existed && userId) {
      const badgeName = before.badgeName;
      onAfterCommit(() => {
        try {
          void Promise.resolve(broadcastBadgeGrant(userId, badgeName)).catch(() => {
            // Ephemeral feedback must never fail badge processing. No replay.
          });
        } catch {
          // Ephemeral feedback must never fail badge processing. No replay.
        }
      });
    }
  },
  async backfill(_configId, limit, config) {
    return storage.workerBadgesDenorm.findNoteCandidates(ruleSchema.parse(config?.data), limit);
  },
  async findWidows(configId, limit, config) {
    return storage.workerBadgesDenorm.findNoteWidows(configId, ruleSchema.parse(config?.data), limit);
  },
};

registerDenormPlugin(plugin);
