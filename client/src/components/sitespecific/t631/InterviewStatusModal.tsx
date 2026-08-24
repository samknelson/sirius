import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type T631InterviewStatus = "offered" | "accepted" | "declined" | "passed" | "failed";
export type T631CommentSlot = "worker" | "employer" | "staff";

export interface T631InterviewViewer {
  personas: string[];
  allowedTargetStatuses: T631InterviewStatus[];
  editableCommentSlots: T631CommentSlot[];
}

export interface T631InterviewRow {
  id: string;
  status: T631InterviewStatus;
  comments: Partial<Record<T631CommentSlot, string>>;
  viewer: T631InterviewViewer;
}

export const T631_STATUS_BADGE: Record<T631InterviewStatus, string> = {
  offered: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  accepted: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  declined: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  passed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const SLOT_LABELS: Record<T631CommentSlot, string> = {
  worker: "Worker comment",
  employer: "Employer comment",
  staff: "Staff comment",
};

const SLOTS: T631CommentSlot[] = ["worker", "employer", "staff"];

interface Props {
  interview: T631InterviewRow | null;
  onClose: () => void;
  /** Invalidate/refetch after a successful save. */
  onSaved: () => void;
}

/**
 * Status transition + per-role comment modal. The server enforces every
 * rule; this UI only offers what the row's `viewer` capabilities allow.
 */
export function InterviewStatusModal({ interview, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [status, setStatus] = useState<T631InterviewStatus | "">("");
  const [comments, setComments] = useState<Partial<Record<T631CommentSlot, string>>>({});

  useEffect(() => {
    if (interview) {
      setStatus("");
      setComments({});
    }
  }, [interview?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (status) body.status = status;
      const edits: Record<string, string> = {};
      for (const slot of SLOTS) {
        const v = comments[slot];
        if (v !== undefined && v !== (interview?.comments[slot] ?? "")) edits[slot] = v;
      }
      if (Object.keys(edits).length > 0) body.comments = edits;
      return apiRequest("POST", `/api/sitespecific/t631/interviews/${interview!.id}/transition`, body);
    },
    onSuccess: () => {
      toast({ title: "Interview updated" });
      onSaved();
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to update interview"),
        variant: "destructive",
      });
    },
  });

  if (!interview) return null;

  const { viewer } = interview;
  const canTransition = viewer.allowedTargetStatuses.length > 0;
  const editable = new Set(viewer.editableCommentSlots);
  const hasChanges =
    !!status ||
    SLOTS.some((s) => comments[s] !== undefined && comments[s] !== (interview.comments[s] ?? ""));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-t631-interview-status">
        <DialogHeader>
          <DialogTitle>Interview</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            Current status:
            <Badge className={T631_STATUS_BADGE[interview.status]} data-testid="badge-current-status">
              {interview.status}
            </Badge>
          </DialogDescription>
        </DialogHeader>

        {canTransition && (
          <div className="space-y-2">
            <Label>Change status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as T631InterviewStatus)}>
              <SelectTrigger data-testid="select-new-status">
                <SelectValue placeholder="Keep current status" />
              </SelectTrigger>
              <SelectContent>
                {viewer.allowedTargetStatuses.map((s) => (
                  <SelectItem key={s} value={s} data-testid={`option-status-${s}`}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-3">
          {SLOTS.map((slot) => (
            <div key={slot} className="space-y-1">
              <Label className="text-sm">{SLOT_LABELS[slot]}</Label>
              {editable.has(slot) ? (
                <Textarea
                  rows={2}
                  value={comments[slot] ?? interview.comments[slot] ?? ""}
                  onChange={(e) => setComments((c) => ({ ...c, [slot]: e.target.value }))}
                  data-testid={`textarea-comment-${slot}`}
                />
              ) : (
                <p
                  className="text-sm text-muted-foreground border rounded-md px-3 py-2 min-h-9 whitespace-pre-wrap"
                  data-testid={`text-comment-${slot}`}
                >
                  {interview.comments[slot] || "—"}
                </p>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-transition">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!hasChanges || mutation.isPending}
            data-testid="button-save-transition"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
