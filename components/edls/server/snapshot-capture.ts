import { registerSnapshotCaptureAdapter } from "../../../server/services/snapshots/capture";
import { entityMetadataStorage } from "../../../server/storage/system/entity-metadata";
import { storage } from "../../../server/storage";
import { EDLS_SHEET_SAVED } from "./events";

/** Shared declaration for application startup and standalone operator tools. */
export function registerEdlsSnapshotCapture(): void {
  registerSnapshotCaptureAdapter({
    event: EDLS_SHEET_SAVED, component: "edls", entityType: "edls_sheet",
    shouldCapture: p => p.previousStatus !== p.newStatus,
    getEntityId: p => p.sheetId,
    getLabel: p => p.previousStatus === null ? `status: → ${p.newStatus}` : `status: ${p.previousStatus} → ${p.newStatus}`,
    exportEntity: p => storage.edlsSheets.export(p.sheetId),
    getMetadata: p => entityMetadataStorage.getSnapshotMetadata(p.sheetId),
  });
}
