import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type Option = { id: string; name: string; closed?: boolean; data?: { entityTypes?: string[] } };
type AssigneeContext = {
  selfId: string;
  canAssignOthers: boolean;
  users: Array<{ id: string; name: string }>;
};

export default function BaoCaseNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const fixedNoteId = query.get("noteId") ?? "";
  const [entityType, setEntityType] = useState(query.get("entityType") ?? "worker");
  const [entityId, setEntityId] = useState(query.get("entityId") ?? "");
  const [deadlineYmd, setDeadline] = useState("");
  const [statusId, setStatus] = useState("");
  const [assigneeUserId, setAssignee] = useState("");
  const [typeId, setTypeId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const { data: statuses = [] } = useQuery<Option[]>({ queryKey: ["/api/options/bao-case-status"] });
  const { data: assigneeCtx } = useQuery<AssigneeContext>({ queryKey: ["/api/sitespecific/bao/cases/assignees"] });
  const canAssignOthers = assigneeCtx?.canAssignOthers ?? false;
  const assignees = assigneeCtx?.users ?? [];
  const { data: noteTypes = [] } = useQuery<Option[]>({ queryKey: ["/api/options/note-type"] });
  const { data: tags = [] } = useQuery<Option[]>({ queryKey: ["/api/options/bao-notes-tag"] });
  const applicableTypes = noteTypes.filter((o) => o.data?.entityTypes?.includes(entityType));
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sitespecific/bao/cases", {
      entityType, entityId, deadlineYmd, statusId,
      // Without the assign permission the case is always created assigned to
      // the actor (the server enforces this either way — omit the field).
      ...(canAssignOthers && assigneeUserId ? { assigneeUserId } : {}),
      ...(fixedNoteId ? { noteId: fixedNoteId } : {
        initialNote: { typeId, subject, body: body || null, tagIds },
      }),
    }),
    onSuccess: (created) => navigate(`/bao/cases/${created.id}`),
    onError: (error: Error) => toast({ title: "Could not create case", description: getApiErrorMessage(error, "Failed to create case."), variant: "destructive" }),
  });
  return (
    <div>
      <PageHeader title="New BAO Case" />
      <main className="mx-auto max-w-2xl p-6">
        <Card><CardContent className="space-y-4 pt-6">
          <div><Label>Entity type</Label><Select value={entityType} onValueChange={setEntityType} disabled={Boolean(query.get("entityType"))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="worker">Worker</SelectItem><SelectItem value="employer">Employer</SelectItem><SelectItem value="trust_provider">Trust Provider</SelectItem></SelectContent></Select></div>
          <div><Label>Entity ID</Label><Input value={entityId} onChange={(e) => setEntityId(e.target.value)} disabled={Boolean(query.get("entityId"))} /></div>
          <div><Label>Deadline</Label><Input type="date" value={deadlineYmd} onChange={(e) => setDeadline(e.target.value)} /></div>
          <div><Label>Status</Label><Select value={statusId} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="Select open status" /></SelectTrigger><SelectContent>{statuses.filter((s) => !s.closed).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
          {canAssignOthers
            ? <div><Label>Assignee (defaults to you)</Label><Select value={assigneeUserId} onValueChange={setAssignee}><SelectTrigger><SelectValue placeholder="Current effective user" /></SelectTrigger><SelectContent>{assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
            : <div><Label>Assignee</Label><p className="text-sm text-muted-foreground" data-testid="text-assignee-self">Assigned to you</p></div>}
          {!fixedNoteId && <>
            <div><Label>Initial note type</Label><Select value={typeId} onValueChange={setTypeId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{applicableTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div><Label>Note</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></div>
            {tags.length > 0 && <div><Label>Tags</Label><div className="flex flex-wrap gap-3 rounded border p-3">{tags.map((tag) => <label key={tag.id} className="flex items-center gap-2 text-sm"><Checkbox checked={tagIds.includes(tag.id)} onCheckedChange={(checked) => setTagIds((old) => checked ? [...new Set([...old, tag.id])] : old.filter((id) => id !== tag.id))} />{tag.name}</label>)}</div></div>}
          </>}
          <Button disabled={mutation.isPending || !entityId || !deadlineYmd || !statusId || (!fixedNoteId && (!typeId || !subject.trim()))} onClick={() => mutation.mutate()} data-testid="button-save-bao-case">Create Case</Button>
        </CardContent></Card>
      </main>
    </div>
  );
}