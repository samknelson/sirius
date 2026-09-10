import { entityMetadataStorage, type EntityMetadataView } from "../storage/system/entity-metadata";
import { metadataRecordHref } from "../storage/entity-metadata-record-tables";
import { escapeHtml } from "@shared/utils/html";

export type RecordGoIdentifier =
  | { kind: "uuid"; value: string }
  | { kind: "sequence"; value: number; revision?: number };

export type RecordGoResolution =
  | { kind: "resolved"; metadata: EntityMetadataView; href: string }
  | { kind: "not_found"; reason: "unknown" | "no_page" };

export type RecordGoAccessRequirement =
  | { kind: "policy"; id: string; componentId?: string }
  | { kind: "permission"; id: string; componentId?: string };

/**
 * The Go-to-record page is a generic entry point, so it cannot rely on the
 * destination route to perform authorization after a redirect. Keep the
 * access requirement for each metadata context here and fail closed for a
 * newly added record page until its view requirement is declared.
 */
const recordGoAccessRequirements: Record<string, RecordGoAccessRequirement> = {
  bargaining_units: { kind: "policy", id: "admin" },
  bulk_messages: { kind: "policy", id: "bulk.edit" },
  cardcheck_definitions: { kind: "permission", id: "staff", componentId: "cardcheck" },
  cardchecks: { kind: "policy", id: "cardcheck.view", componentId: "cardcheck" },
  companies: { kind: "policy", id: "staff", componentId: "employer.company" },
  contracts: { kind: "policy", id: "staff", componentId: "contract" },
  dispatch_job_group: { kind: "policy", id: "authenticated", componentId: "dispatch.job_group" },
  dispatch_jobs: { kind: "policy", id: "admin", componentId: "dispatch" },
  dispatches: { kind: "policy", id: "worker.view", componentId: "dispatch" },
  edls_sheets: { kind: "policy", id: "edls.sheet.view", componentId: "edls" },
  employer_contacts: { kind: "policy", id: "employer.manage" },
  employers: { kind: "policy", id: "employer.view" },
  events: { kind: "policy", id: "admin", componentId: "event" },
  facilities: { kind: "policy", id: "facility.view", componentId: "facility" },
  grievance_timeline_templates: { kind: "policy", id: "staff", componentId: "grievance" },
  grievances: { kind: "policy", id: "staff", componentId: "grievance" },
  policies: { kind: "policy", id: "admin" },
  sftp_client_destinations: { kind: "policy", id: "admin", componentId: "system.sftp.client" },
  sitespecific_btu_csg: { kind: "policy", id: "authenticated", componentId: "sitespecific.btu" },
  trust_benefits: { kind: "permission", id: "staff" },
  trust_provider_contacts: { kind: "policy", id: "staff" },
  trust_providers: { kind: "permission", id: "staff", componentId: "trust.providers" },
  users: { kind: "policy", id: "admin" },
  wizards: { kind: "policy", id: "employer.mine" },
  worker_hours: { kind: "permission", id: "staff" },
  worker_trust_elections: { kind: "policy", id: "staff", componentId: "trust.elections" },
  workers: { kind: "policy", id: "worker.view" },
  ws_clients: { kind: "permission", id: "admin" },
};

export function recordGoAccessRequirement(contextId: string): RecordGoAccessRequirement | undefined {
  return recordGoAccessRequirements[contextId];
}

const SEQUENCE_PART = /^\d+(?:\.\d+)*$/;
const UUID_PART = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a copied metadata id, record id, raw sequence, or grouped badge.
 * The revision is intentionally advisory: the current metadata row owns the
 * destination, even when copied revision text is stale.
 */
export function parseRecordGoIdentifier(input: string): RecordGoIdentifier | null {
  const value = input.trim();
  if (UUID_PART.test(value)) return { kind: "uuid", value };

  const [sequenceText, revisionText, ...extra] = value.split("::");
  if (extra.length > 0 || !SEQUENCE_PART.test(sequenceText)) return null;

  const sequenceDigits = sequenceText.replaceAll(".", "");
  const sequence = Number(sequenceDigits);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return null;

  if (revisionText === undefined) {
    return { kind: "sequence", value: sequence };
  }
  if (!SEQUENCE_PART.test(revisionText)) return null;

  const revision = Number(revisionText.replaceAll(".", ""));
  if (!Number.isSafeInteger(revision) || revision <= 0) return null;
  return { kind: "sequence", value: sequence, revision };
}

export async function resolveRecordGoIdentifier(
  input: string,
): Promise<RecordGoResolution> {
  const parsed = parseRecordGoIdentifier(input);
  if (!parsed) return { kind: "not_found", reason: "unknown" };

  const metadata =
    parsed.kind === "uuid"
      ? (await entityMetadataStorage.getByMetadataId(parsed.value)) ??
        (await entityMetadataStorage.get(parsed.value))
      : await entityMetadataStorage.getBySequence(parsed.value);

  if (!metadata) return { kind: "not_found", reason: "unknown" };

  const href = metadataRecordHref(metadata.contextId, metadata.entityId);
  if (!href) return { kind: "not_found", reason: "no_page" };
  return { kind: "resolved", metadata, href };
}
