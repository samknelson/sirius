import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type {
  RecordMetadata,
  RecordHistoryState,
} from "@/components/shared/RecordHistoryDialog";

const RECORD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RECORD_METADATA_PERMISSION = "metadata.view";

export function hasRecordMetadataPermission(permissions: readonly string[]): boolean {
  return permissions.includes(RECORD_METADATA_PERMISSION);
}

export interface UseRecordMetadataResult {
  /** False when there is no record id to ask about; nothing was asked. */
  isRecordId: boolean;
  /** The record's history, or null once we know it has none recorded. */
  metadata: RecordMetadata | null;
  /** The same three states {@link RecordHistoryDialog} is handed. */
  state: RecordHistoryState;
  /** Whether this user may view record metadata. */
  canViewMetadata: boolean;
  /** Ask again — for the moment someone actually looks. */
  refetch: () => void;
}

/** Whether this is a record's own id, and therefore something to ask about. */
export function isRecordId(entityId: string | null | undefined): entityId is string {
  return !!entityId && RECORD_ID_PATTERN.test(entityId);
}

/**
 * One record's history, from the one endpoint that answers for it: when it was
 * created, when it last changed, and who did each.
 *
 * The one place the client asks. A page can show a record's creation date in
 * its own words, and the badge in the corner opens the full history; both are
 * the same fact and must be read the same way, or a page ends up displaying a
 * date the badge disagrees with. That is exactly what happened while pages
 * read their own bespoke `created_at` column, and this hook is what keeps the
 * two answers to one.
 *
 * A record with nothing recorded answers `null`, which is an ordinary answer
 * and not an error: every record that predates this bookkeeping reads that way
 * until something touches it.
 *
 * Nothing invalidates this query, so it is never treated as settled: a
 * record's history is written by whatever mutation caused it, moments after
 * that mutation answered, and by other people's mutations besides. The
 * client's default is to cache a query forever, which here would pin a
 * record's history to whatever was true when the page first opened. A record
 * created seconds ago is the sharpest case: its first read can beat the
 * after-commit write and see nothing at all.
 */
export function useRecordMetadata(
  entityId: string | null | undefined,
): UseRecordMetadataResult {
  const { hasPermission } = useAuth();
  const canViewMetadata = hasPermission(RECORD_METADATA_PERMISSION);
  const enabled = canViewMetadata && isRecordId(entityId);

  const { data, isFetching, isError, refetch } = useQuery<{
    metadata: RecordMetadata | null;
  }>({
    queryKey: ["/api/entity-metadata", entityId],
    enabled,
    retry: false,
    staleTime: 0,
  });

  const metadata = data?.metadata ?? null;

  const state: RecordHistoryState = !enabled
    ? { status: "loading" }
    : isFetching && !data
      ? { status: "loading" }
      : isError
        ? { status: "error" }
        : { status: "ready", metadata };

  return {
    isRecordId: enabled,
    metadata,
    state,
    canViewMetadata,
    refetch: () => {
      void refetch();
    },
  };
}
