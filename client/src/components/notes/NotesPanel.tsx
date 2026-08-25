import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { NotebookPen, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { Link } from "wouter";

interface NoteTypeOption {
  id: string;
  name: string;
  description: string | null;
  data: { entityTypes?: string[] } | null;
}

interface NoteTag {
  id: string;
  name: string;
  tagTypeId: string;
  tagTypeName: string | null;
  tagTypeSequence: number | null;
}

interface NoteTagOption {
  id: string;
  name: string;
  tagTypeId: string;
  sequence: number;
}

interface NoteTagTypeOption {
  id: string;
  name: string;
  sequence: number;
}

interface NoteRow {
  id: string;
  entityType: string;
  entityId: string;
  typeId: string;
  subject: string;
  body: string | null;
  timestamp: string;
  userId: string | null;
  typeName: string | null;
  authorName: string | null;
  /** Present only on BAO deployments (sitespecific.bao enabled). */
  tags?: NoteTag[];
  caseId?: string | null;
}

interface NotesPanelProps {
  /** Registered note-able record type, e.g. "worker". */
  entityType: string;
  /** Id of the record the notes hang off. */
  entityId: string;
}

function formatTimestamp(value: string): string {
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "MMM d, yyyy h:mm a") : value;
}

/**
 * Notes tab content, shared by every note-able record type.
 *
 * The only thing that varies per record is the `entityType` / `entityId` pair:
 * the note-type dropdown filters itself to the types that declare this record
 * type, and every mutation posts the pair back. Staff-only — the tab itself is
 * gated, and the API refuses non-staff regardless.
 */
export default function NotesPanel({ entityType, entityId }: NotesPanelProps) {
  const { toast } = useToast();
  const auth = useAuth();
  // Note tagging is BAO-only: no tag UI (and no tag queries) elsewhere.
  const tagsEnabled = auth?.hasComponent("sitespecific.bao") ?? false;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<NoteRow | null>(null);
  const [deletingNote, setDeletingNote] = useState<NoteRow | null>(null);
  const [formTypeId, setFormTypeId] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formTagIds, setFormTagIds] = useState<string[]>([]);

  const notesQueryKey = ["/api/notes", entityType, entityId];

  const { data: notes = [], isLoading } = useQuery<NoteRow[]>({
    queryKey: notesQueryKey,
  });

  const { data: allNoteTypes = [] } = useQuery<NoteTypeOption[]>({
    queryKey: ["/api/options/note-type"],
  });

  // Only types that declare this record type are offerable; the server
  // enforces the same pairing on save.
  const noteTypes = useMemo(
    () => allNoteTypes.filter((t) => (t.data?.entityTypes ?? []).includes(entityType)),
    [allNoteTypes, entityType],
  );

  const { data: tagOptions = [] } = useQuery<NoteTagOption[]>({
    queryKey: ["/api/options/bao-notes-tag"],
    enabled: tagsEnabled,
  });
  const { data: tagTypes = [] } = useQuery<NoteTagTypeOption[]>({
    queryKey: ["/api/options/bao-notes-tag-type"],
    enabled: tagsEnabled,
  });

  // The picker groups tags by tag type, ordered by tag type sequence then
  // tag sequence/name.
  const tagGroups = useMemo(() => {
    if (!tagsEnabled || tagOptions.length === 0) return [];
    const sortedTypes = [...tagTypes].sort(
      (a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name),
    );
    const byType = new Map<string, NoteTagOption[]>();
    for (const tag of tagOptions) {
      const list = byType.get(tag.tagTypeId) ?? [];
      list.push(tag);
      byType.set(tag.tagTypeId, list);
    }
    const groups: { id: string; name: string; tags: NoteTagOption[] }[] = [];
    for (const type of sortedTypes) {
      const tags = (byType.get(type.id) ?? []).sort(
        (a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name),
      );
      if (tags.length > 0) groups.push({ id: type.id, name: type.name, tags });
      byType.delete(type.id);
    }
    return groups;
  }, [tagsEnabled, tagOptions, tagTypes]);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingNote(null);
    setFormTypeId("");
    setFormSubject("");
    setFormBody("");
    setFormTagIds([]);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: notesQueryKey });
  };

  const createMutation = useMutation({
    mutationFn: async (data: { typeId: string; subject: string; body: string | null; tagIds: string[] }) => {
      const { tagIds, ...note } = data;
      const created = await apiRequest("POST", "/api/notes", { entityType, entityId, ...note });
      if (tagsEnabled && tagIds.length > 0 && created?.id) {
        await apiRequest("PUT", `/api/notes/${created.id}/tags`, { tagIds });
      }
      return created;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Note added" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: getApiErrorMessage(error, "Failed to add note."), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { typeId: string; subject: string; body: string | null; tagIds: string[] } }) => {
      const { tagIds, ...note } = data;
      const updated = await apiRequest("PUT", `/api/notes/${id}`, note);
      if (tagsEnabled) {
        await apiRequest("PUT", `/api/notes/${id}/tags`, { tagIds });
      }
      return updated;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Note updated" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: getApiErrorMessage(error, "Failed to update note."), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/notes/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Note deleted" });
      setDeletingNote(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: getApiErrorMessage(error, "Failed to delete note."), variant: "destructive" });
      setDeletingNote(null);
    },
  });

  const openAddDialog = () => {
    setEditingNote(null);
    setFormTypeId(noteTypes[0]?.id ?? "");
    setFormSubject("");
    setFormBody("");
    setFormTagIds([]);
    setIsDialogOpen(true);
  };

  const openEditDialog = (note: NoteRow) => {
    setEditingNote(note);
    setFormTypeId(note.typeId);
    setFormSubject(note.subject);
    setFormBody(note.body ?? "");
    setFormTagIds((note.tags ?? []).map((t) => t.id));
    setIsDialogOpen(true);
  };

  const toggleFormTag = (tagId: string, checked: boolean) => {
    setFormTagIds((prev) =>
      checked ? Array.from(new Set([...prev, tagId])) : prev.filter((id) => id !== tagId),
    );
  };

  const handleSave = () => {
    if (!formTypeId) {
      toast({ title: "Note type required", description: "Choose a note type.", variant: "destructive" });
      return;
    }
    if (formSubject.trim() === "") {
      toast({ title: "Subject required", description: "Enter a subject for this note.", variant: "destructive" });
      return;
    }
    const payload = {
      typeId: formTypeId,
      subject: formSubject.trim(),
      body: formBody.trim() === "" ? null : formBody,
      tagIds: formTagIds,
    };
    if (editingNote) {
      updateMutation.mutate({ id: editingNote.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const noTypesConfigured = noteTypes.length === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <NotebookPen className="h-5 w-5" />
              Notes
            </CardTitle>
            <CardDescription>Staff-only notes on this record.</CardDescription>
          </div>
          <Button onClick={openAddDialog} disabled={noTypesConfigured} data-testid="button-add-note">
            <Plus className="h-4 w-4 mr-2" />
            Add Note
          </Button>
        </CardHeader>
        <CardContent>
          {noTypesConfigured && (
            <p className="text-sm text-muted-foreground" data-testid="text-no-note-types">
              No note types apply to this kind of record yet. An administrator can add one under Dropdown Lists → Note Types.
            </p>
          )}

          {isLoading ? (
            <div className="space-y-3" data-testid="loading-notes">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : notes.length === 0 ? (
            !noTypesConfigured && (
              <p className="text-sm text-muted-foreground" data-testid="text-no-notes">
                No notes on this record yet.
              </p>
            )
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-md border p-4 space-y-2"
                  data-testid={`card-note-${note.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" data-testid={`badge-note-type-${note.id}`}>
                          {note.typeName ?? "Unknown type"}
                        </Badge>
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
                        onClick={() => openEditDialog(note)}
                        data-testid={`button-edit-note-${note.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingNote(note)}
                        data-testid={`button-delete-note-${note.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {note.body && (
                    <p className="text-sm whitespace-pre-wrap" data-testid={`text-note-body-${note.id}`}>
                      {note.body}
                    </p>
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? setIsDialogOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingNote ? "Edit Note" : "Add Note"}</DialogTitle>
            <DialogDescription>
              {editingNote ? "Update this note." : "Add a staff note to this record."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="note-type">Type</Label>
              <Select value={formTypeId} onValueChange={setFormTypeId}>
                <SelectTrigger id="note-type" data-testid="select-note-type">
                  <SelectValue placeholder="Select a note type" />
                </SelectTrigger>
                <SelectContent>
                  {noteTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id} data-testid={`option-note-type-${type.id}`}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-subject">Subject</Label>
              <Input
                id="note-subject"
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                placeholder="What is this note about?"
                data-testid="input-note-subject"
              />
            </div>
            {tagsEnabled && tagGroups.length > 0 && (
              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="rounded-md border p-3 space-y-3 max-h-56 overflow-y-auto" data-testid="picker-note-tags">
                  {tagGroups.map((group) => (
                    <div key={group.id} className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {group.name}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {group.tags.map((tag) => (
                          <label key={tag.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={formTagIds.includes(tag.id)}
                              onCheckedChange={(checked) => toggleFormTag(tag.id, checked === true)}
                              data-testid={`checkbox-note-tag-${tag.id}`}
                            />
                            {tag.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="note-body">Note (optional)</Label>
              <Textarea
                id="note-body"
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={6}
                placeholder="Details…"
                data-testid="textarea-note-body"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending} data-testid="button-cancel-note">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending} data-testid="button-save-note">
              {isPending ? "Saving..." : editingNote ? "Save Changes" : "Add Note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deletingNote !== null} onOpenChange={(open) => (open ? null : setDeletingNote(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingNote ? `"${deletingNote.subject}" will be permanently removed.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-note">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingNote && deleteMutation.mutate(deletingNote.id)}
              data-testid="button-confirm-delete-note"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
