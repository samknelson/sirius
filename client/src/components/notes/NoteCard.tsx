import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Pencil, Tag, Trash2 } from "lucide-react";
import { parseISO, isValid } from "date-fns";
import { format } from "@/lib/date-format";
import { Link } from "wouter";
import { firstLineOf } from "./note-display";

export interface NoteTag {
  id: string;
  name: string;
  tagTypeId: string;
  tagTypeName: string | null;
  tagTypeSequence: number | null;
}

export interface NoteRow {
  id: string;
  entityType: string;
  entityId: string;
  typeId: string;
  subject: string;
  body: string | null;
  data?: Record<string, unknown> | null;
  timestamp: string;
  userId: string | null;
  typeName: string | null;
  authorName: string | null;
  /** Present only on BAO deployments (sitespecific.bao enabled). */
  tags?: NoteTag[];
  caseId?: string | null;
}

export interface NoteCardProps {
  note: NoteRow;
  /** BAO-only surfaces: tag badges and the case link/create buttons. */
  tagsEnabled: boolean;
  entityType: string;
  entityId: string;
  /** Whether the complete body is shown (true) or the compact preview (false). */
  expanded: boolean;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function formatTimestamp(value: string): string {
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "MMM d, yyyy h:mm a") : value;
}

/**
 * One note in the shared notes list.
 *
 * The type badge, imported marker, subject, author/timestamp line, tags and
 * the action buttons are ALWAYS visible — expand/collapse only changes how
 * the body renders: complete and whitespace-preserved when expanded, the
 * first non-blank line when compact. The toggle is a real button carrying
 * `aria-expanded` and `aria-controls` so its state is announced.
 */
export default function NoteCard({
  note,
  tagsEnabled,
  entityType,
  entityId,
  expanded,
  onToggleExpanded,
  onEdit,
  onDelete,
}: NoteCardProps) {
  // Import provenance: migration-created notes carry their loader name in
  // `data.s1Loader` (see the S1 note loaders). Display-only — nothing here
  // reads or writes anything else about provenance.
  const isImported = Boolean((note.data as Record<string, unknown> | null | undefined)?.s1Loader);
  const { preview, hasMore } = firstLineOf(note.body);
  const bodyId = `note-body-${note.id}`;

  return (
    <div className="rounded-md border p-4 space-y-2" data-testid={`card-note-${note.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" data-testid={`badge-note-type-${note.id}`}>
              {note.typeName ?? "Unknown type"}
            </Badge>
            {isImported && (
              <Badge variant="outline" data-testid={`badge-note-imported-${note.id}`}>
                Imported
              </Badge>
            )}
            <span className="font-medium" data-testid={`text-note-subject-${note.id}`}>
              {note.subject}
            </span>
          </div>
          <p className="text-xs text-muted-foreground" data-testid={`text-note-meta-${note.id}`}>
            {formatTimestamp(note.timestamp)}
            {note.authorName ? ` · ${note.authorName}` : ""}
          </p>
        </div>
        <div className="flex gap-1">
          {tagsEnabled && (
            note.caseId ? (
              <Link href={`/bao/cases/${note.caseId}`}>
                <Button variant="outline" size="sm" data-testid={`button-view-case-note-${note.id}`}>View Case</Button>
              </Link>
            ) : (
              <Link href={`/bao/cases/new?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&noteId=${encodeURIComponent(note.id)}`}>
                <Button variant="outline" size="sm" data-testid={`button-create-case-note-${note.id}`}>Create Case</Button>
              </Link>
            )
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            aria-label="Edit note"
            data-testid={`button-edit-note-${note.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Delete note"
            data-testid={`button-delete-note-${note.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-label={expanded ? "Collapse note" : "Expand note"}
            data-testid={`button-toggle-note-${note.id}`}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {expanded ? (
        note.body && (
          <p id={bodyId} className="text-sm whitespace-pre-wrap" data-testid={`text-note-body-${note.id}`}>
            {note.body}
          </p>
        )
      ) : (
        preview !== null && (
          <p id={bodyId} className="text-sm text-muted-foreground truncate" data-testid={`text-note-preview-${note.id}`}>
            {preview}
            {hasMore ? "…" : ""}
          </p>
        )
      )}
      {tagsEnabled && (note.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid={`tags-note-${note.id}`}>
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          {note.tags!.map((tag) => (
            <Badge key={tag.id} variant="outline" data-testid={`badge-note-tag-${note.id}-${tag.id}`}>
              {tag.tagTypeName ? `${tag.tagTypeName}: ${tag.name}` : tag.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
