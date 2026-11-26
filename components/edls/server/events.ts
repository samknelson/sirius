import { registerComponentEvent } from "../../../server/services/event-bus";
import type { EdlsSheet } from "../shared/schema/edls/schema";

/** Emitted after commit; the save captures its snapshot inside its transaction. */
export interface EdlsSheetSavedPayload {
  sheetId: string;
  previousStatus: string | null;
  newStatus: string;
  sheet: EdlsSheet;
}

declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap {
    "edls.sheet.saved": EdlsSheetSavedPayload;
  }
}

export const EDLS_SHEET_SAVED = registerComponentEvent("edls.sheet.saved");
