import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BaoDcCaseNote } from "@shared/schema";

/**
 * Append-only case notes: no edit, no delete. A correction is a NEW note
 * linked to the note it corrects.
 */
export function DcNotesCard({ caseId, notes }: { caseId: string; notes: BaoDcCaseNote[] }) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [correctsNoteId, setCorrectsNoteId] = useState<string | null>(null);

  const addNote = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/sitespecific/bao/dc/cases/${caseId}/notes`, {
        body,
        ...(correctsNoteId ? { correctsNoteId } : {}),
      }),
    onSuccess: () => {
      setBody("");
      setCorrectsNoteId(null);
      queryClient.invalidateQueries({
        queryKey: ["/api/sitespecific/bao/dc/cases", caseId],
      });
    },
    onError: (err) =>
      toast({
        title: "Could not add note",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  const byId = new Map(notes.map((n) => [n.id, n]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notes</CardTitle>
        <CardDescription>
          Notes cannot be edited or deleted — corrections are new entries linked to the
          original.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-dc-notes-empty">
            No notes yet.
          </p>
        ) : (
          <div className="space-y-3">
            {notes.map((n) => (
              <div key={n.id} className="border rounded-md p-3" data-testid={`note-dc-${n.id}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs text-muted-foreground">
                    {n.createdAt ? new Date(n.createdAt as unknown as string).toLocaleString() : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    {n.correctsNoteId && (
                      <Badge variant="secondary" data-testid={`badge-dc-note-correction-${n.id}`}>
                        Corrects: “{(byId.get(n.correctsNoteId)?.body ?? "").slice(0, 40)}…”
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCorrectsNoteId(n.id)}
                      data-testid={`button-dc-note-correct-${n.id}`}
                    >
                      Correct
                    </Button>
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{n.body}</p>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {correctsNoteId && (
            <p className="text-xs text-muted-foreground">
              Adding a correction to an earlier note.{" "}
              <button className="underline" onClick={() => setCorrectsNoteId(null)}>
                Cancel
              </button>
            </p>
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={correctsNoteId ? "Corrected note text…" : "Add a note…"}
            data-testid="input-dc-note"
          />
          <Button
            onClick={() => addNote.mutate()}
            disabled={!body.trim() || addNote.isPending}
            data-testid="button-dc-add-note"
          >
            {correctsNoteId ? "Add correction" : "Add note"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
