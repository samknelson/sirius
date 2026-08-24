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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";

interface NoteTypeOption {
  id: string;
  name: string;
  description: string | null;
  data: { entityTypes?: string[] } | null;
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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<NoteRow | null>(null);
  const [deletingNote, setDeletingNote] = useState<NoteRow | null>(null);
  const [formTypeId, setFormTypeId] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");

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

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingNote(null);
    setFormTypeId("");
    setFormSubject("");
    setFormBody("");
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: notesQueryKey });
  };

  const createMutation = useMutation({
    mutationFn: async (data: { typeId: string; subject: string; body: string | null }) =>
      apiRequest("POST", "/api/notes", { entityType, entityId, ...data }),
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
    mutationFn: async ({ id, data }: { id: string; data: { typeId: string; subject: string; body: string | null } }) =>
      apiRequest("PUT", `/api/notes/${id}`, data),
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
    setIsDialogOpen(true);
  };

  const openEditDialog = (note: NoteRow) => {
    setEditingNote(note);
    setFormTypeId(note.typeId);
    setFormSubject(note.subject);
    setFormBody(note.body ?? "");
    setIsDialogOpen(true);
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
