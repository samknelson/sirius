import { useTabAccess } from "@/hooks/useTabAccess";

export function useEdlsSheetTabAccess(sheetId: string | undefined, enabled = true) {
  return useTabAccess({ entityType: "edls_sheet", entityId: sheetId, enabled });
}
