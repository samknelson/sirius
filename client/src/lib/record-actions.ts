/** Host-owned record action slot; contributions do not grant record access. */
export const RECORD_ACTIONS_SLOT = "record.actions";
export interface RecordActionsProps { record: unknown; entityLabel: string }
