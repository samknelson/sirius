/**
 * Shared write rules for the unified options registry.
 *
 * Every rule the single-record create / update / delete routes enforce lives
 * here so the JSON import planner can enforce exactly the same ones. The
 * import must not be able to write anything the single-record form would
 * reject, so both call these helpers rather than keeping their own copies.
 */
import { isNoteEntityType } from "@shared/notes";
import { jobTypeBullpenEnum } from "@shared/schema";
import { storage } from "../storage";
import { getOptionsStorage, type OptionsTypeConfig } from "./options-registry";

/**
 * Map a caught database error to a clear, user-facing message (or null if
 * unrecognized).
 */
export function optionDbErrorMessage(error: any): { status: number; message: string } | null {
  // Unique violation — name the offending field when the constraint tells us.
  if (error?.code === "23505") {
    const field = humanizeConstraintColumn(error);
    return {
      status: 400,
      message: field
        ? `An item with this ${field} already exists. ${field === "Sirius ID" ? "Sirius IDs must be unique." : "Please choose a different value."}`
        : "An item with this value already exists",
    };
  }
  // Not-null violation — name the missing column.
  if (error?.code === "23502") {
    const column = error?.column ? String(error.column) : null;
    return {
      status: 400,
      message: column ? `${column.replace(/_/g, " ")} is required` : "A required field is missing",
    };
  }
  // FK violation on insert/update — referenced record doesn't exist.
  if (error?.code === "23503") {
    return { status: 400, message: "A referenced record does not exist" };
  }
  return null;
}

function humanizeConstraintColumn(error: any): string | null {
  const constraint = error?.constraint ? String(error.constraint) : "";
  if (constraint.includes("sirius_id")) return "Sirius ID";
  if (constraint.includes("name")) return "name";
  if (constraint.includes("code")) return "code";
  return null;
}

/**
 * Validate the bullpen fields inside a dispatch-job-type `data` payload
 * (dispatch.bullpen component). Returns an error message or null.
 * Enforced whenever bullpen fields are present so a direct API call cannot
 * persist an invalid combination regardless of what the UI shows.
 *
 * Note: this normalizes the payload in place, dropping a dangling
 * `bullpenEventTypeId` when bullpen is "none" or absent.
 */
function validateDispatchJobTypeBullpen(data: unknown): string | null {
  if (data === null || data === undefined || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const bullpen = d.bullpen;
  if ("bullpen" in d) {
    if (typeof bullpen !== "string" || !(jobTypeBullpenEnum as readonly string[]).includes(bullpen)) {
      return `bullpen must be one of: ${jobTypeBullpenEnum.join(", ")}`;
    }
  }
  if (bullpen === "host" || bullpen === "shared") {
    const eventTypeId = d.bullpenEventTypeId;
    if (typeof eventTypeId !== "string" || eventTypeId.trim() === "") {
      return "An event type is required when Bullpen is set to host or shared";
    }
  } else {
    // Keep persisted JSON consistent: no dangling event-type reference
    // when bullpen is "none" or absent.
    delete d.bullpenEventTypeId;
  }
  return null;
}

/**
 * Validation for `worker-ban-type` writes: `data.pluginIds` must be a
 * non-empty array of registered worker-ban plugin ids. The UI already
 * constrains this via the ban-plugins widget, but a direct API call must
 * not persist unknown plugin ids. Returns an error message or null.
 */
async function validateWorkerBanTypePlugins(data: unknown): Promise<string | null> {
  const pluginIds = (data as { pluginIds?: unknown } | null | undefined)?.pluginIds;
  if (!Array.isArray(pluginIds) || pluginIds.length === 0) {
    return "At least one ban behavior is required";
  }
  const { workerBanPluginRegistry } = await import("../plugins/worker-bans/registry");
  const known = new Set(workerBanPluginRegistry.listIds());
  const unknown = pluginIds.filter((p) => typeof p !== "string" || !known.has(p));
  if (unknown.length > 0) {
    return `Unknown ban behavior(s): ${unknown.join(", ")}`;
  }
  const defaultDurationDays = (data as { defaultDurationDays?: unknown } | null | undefined)?.defaultDurationDays;
  if (defaultDurationDays !== undefined && defaultDurationDays !== null) {
    if (typeof defaultDurationDays !== "number" || !Number.isInteger(defaultDurationDays) || defaultDurationDays < 1) {
      return "Default duration (days) must be a positive integer";
    }
  }
  return null;
}

/**
 * Validation for `note-type` writes: `data.entityTypes` must be a non-empty
 * array of record types registered in the shared note-entity registry. The
 * form constrains this via a multi-select, but a direct API call must not be
 * able to declare a type for a record kind that cannot hold notes.
 */
function validateNoteTypeEntityTypes(data: unknown): string | null {
  const entityTypes = (data as { entityTypes?: unknown } | null | undefined)?.entityTypes;
  if (!Array.isArray(entityTypes) || entityTypes.length === 0) {
    return "At least one record type is required";
  }
  const unknown = entityTypes.filter((t) => typeof t !== "string" || !isNoteEntityType(t));
  if (unknown.length > 0) {
    return `Unknown record type(s): ${unknown.join(", ")}`;
  }
  return null;
}

/**
 * Run the per-type special validators against a `data` payload. Callers pass
 * the JSONB `data` value exactly as it will be persisted.
 */
export async function validateOptionTypeSpecificData(
  type: string,
  data: unknown,
): Promise<string | null> {
  if (type === "dispatch-job-type") {
    return validateDispatchJobTypeBullpen(data);
  }
  if (type === "note-type") {
    return validateNoteTypeEntityTypes(data);
  }
  if (type === "worker-ban-type") {
    return await validateWorkerBanTypePlugins(data);
  }
  return null;
}

/**
 * Enforce fixed-value (enum) fields so no write path can persist a value
 * outside the allowed set.
 */
export function checkOptionEnumValues(
  config: OptionsTypeConfig,
  values: Record<string, any>,
): string | null {
  for (const [field, allowed] of Object.entries(config.enumConstraints)) {
    const value = values[field];
    if (value !== undefined && value !== null && !allowed.includes(value)) {
      return `${field} must be one of: ${allowed.join(", ")}`;
    }
  }
  return null;
}

/**
 * Build the insert payload for a create: required fields must be present and
 * non-empty, optional empty strings are dropped so database defaults apply,
 * and strings are trimmed.
 */
export function buildOptionCreateData(
  config: OptionsTypeConfig,
  body: Record<string, any>,
): { data: Record<string, any> } | { error: string } {
  for (const field of config.requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return { error: `${field} is required` };
    }
  }

  const data: Record<string, any> = {};
  for (const field of config.requiredFields) {
    const value = typeof body[field] === "string" ? body[field].trim() : body[field];
    data[field] = value;
  }
  for (const field of config.optionalFields) {
    if (body[field] !== undefined) {
      const value = typeof body[field] === "string" ? body[field].trim() : body[field];
      // Skip empty strings for optional fields to let database defaults apply
      if (value !== "") {
        data[field] = value;
      }
    }
  }

  const enumError = checkOptionEnumValues(config, data);
  if (enumError) return { error: enumError };

  return { data };
}

/**
 * Build the update payload: absent fields are left unchanged, an explicit
 * `null` clears an optional column, an empty string on an optional field is
 * ignored, and a required field may not be cleared.
 */
export function buildOptionUpdateData(
  config: OptionsTypeConfig,
  body: Record<string, any>,
): { updates: Record<string, any> } | { error: string } {
  const updates: Record<string, any> = {};
  const allFields = [...config.requiredFields, ...config.optionalFields];

  for (const field of allFields) {
    if (body[field] !== undefined) {
      const value = typeof body[field] === "string" ? body[field].trim() : body[field];
      if (config.requiredFields.includes(field) && (value === null || value === "")) {
        return { error: `${field} cannot be empty` };
      }
      // Skip empty strings for optional fields to let database defaults/current values remain
      if (config.optionalFields.includes(field) && value === "") {
        continue;
      }
      updates[field] = value;
    }
  }

  const enumError = checkOptionEnumValues(config, updates);
  if (enumError) return { error: enumError };

  return { updates };
}

/**
 * Pre-delete guards for the option types whose rows are referenced without a
 * database foreign key (or with an ON DELETE RESTRICT one we want to explain).
 * Returns a status + message when the delete must be refused.
 */
export async function checkOptionDeleteGuard(
  type: string,
  id: string,
): Promise<{ status: number; message: string } | null> {
  // A grievance status that is referenced by any timeline-template step
  // cannot be deleted — the step stores status ids as plain arrays (no FK),
  // so we guard the delete here to avoid orphaning those references.
  if (type === "grievance-status") {
    const referenced = await storage.grievanceTimelineTemplates.isStatusReferenced(id);
    if (referenced) {
      return {
        status: 409,
        message:
          "This status is used by a grievance timeline template and cannot be deleted. Remove it from all timeline steps first.",
      };
    }
  }

  // A note type still used by any note cannot be deleted. The FK is ON
  // DELETE RESTRICT so the database would refuse anyway; this pre-check
  // turns that into a message that says what to do about it.
  if (type === "note-type") {
    const inUse = await storage.notes.countByTypeId(id);
    if (inUse > 0) {
      return {
        status: 409,
        message: `This note type is used by ${inUse} note${inUse === 1 ? "" : "s"} and cannot be deleted. Retype or delete those notes first.`,
      };
    }
  }

  // A worker ban type referenced by any ban cannot be deleted —
  // `worker_bans.type` is a soft reference (no FK), so guard here to
  // avoid orphaning bans onto an unknown (unenforced) type.
  if (type === "worker-ban-type") {
    const allBans = await storage.workerBans.getAll();
    if (allBans.some((ban) => ban.type === id)) {
      return {
        status: 409,
        message:
          "This ban type is used by one or more worker bans and cannot be deleted. Remove or retype those bans first.",
      };
    }
  }

  // A note tag type with tags under it cannot be deleted — the FK would
  // cascade the tags (and their note assignments) away silently, so we
  // guard here and tell the admin what to remove first.
  if (type === "bao-notes-tag-type") {
    const tags = await getOptionsStorage().list("bao-notes-tag");
    const inUse = tags.filter((t: any) => t.tagTypeId === id).length;
    if (inUse > 0) {
      return {
        status: 409,
        message: `This tag type has ${inUse} tag${inUse === 1 ? "" : "s"} under it and cannot be deleted. Delete or re-type those tags first.`,
      };
    }
  }

  // BAO case statuses/resolutions are live case state (sitespecific.bao).
  if (type === "bao-case-status") {
    const inUse = await storage.baoCases.countByStatus(id);
    if (inUse > 0) {
      return { status: 409, message: "This BAO case status is in use and cannot be deleted." };
    }
  }
  if (type === "bao-case-resolution") {
    const inUse = await storage.baoCases.countByResolution(id);
    if (inUse > 0) {
      return { status: 409, message: "This BAO case resolution is in use and cannot be deleted." };
    }
  }

  return null;
}

/**
 * The fallback message for a foreign-key RESTRICT violation raised by the
 * database when nothing above caught the reference first.
 */
export function optionInUseDeleteMessage(displayName: string | undefined): string {
  return `This ${displayName ?? "option"} is in use and cannot be deleted. Remove it from everything that references it first.`;
}
