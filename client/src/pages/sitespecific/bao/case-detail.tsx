import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CaseLettersCard, type CaseLetter } from "@/components/sitespecific/bao/CaseLettersCard";

type Option = { id: string; name: string; closed?: boolean; data?: { entityTypes?: string[] } };
interface CaseDetail {
  id: string; entityType: string; entityId: string; entityName: string | null;
  assigneeUserId: string; assigneeName: string; statusId: string; statusName: string;
  statusClosed: boolean; createdAt: string; deadlineYmd: string;
  resolutionId: string | null; resolutionName: string | null; resolutionYmd: string | null;
  notes: Array<{ id: string; typeId: string; typeName: string | null; subject: string; body: string | null; timestamp: string; authorName: string | null; tags?: Array<{ tagId?: string; tagName?: string; name?: string }> }>;
  letters: CaseLetter[];
  mailingAddressOnFile: boolean;
}

export default function BaoCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const key = ["/api/sitespecific/bao/cases", id];
  const { data: record } = useQuery<CaseDetail>({ queryKey: key });
  const { data: statuses = [] } = useQuery<Option[]>({ queryKey: ["/api/options/bao-case-status"] });
  const { data: resolutions = [] } = useQuery<Option[]>({ queryKey: ["/api/options/bao-case-resolution"] });
  const { data: noteTypes = [] } = useQuery<Option[]>({ queryKey: ["/api/options/note-type"] });
  const { data: tags = [] } = useQuery<Option[]>({ queryKey: ["/api/options/bao-notes-tag"] });
  const { data: assigneeCtx } = useQuery<{ selfId: string; canAssignOthers: boolean; users: Array<{ id: string; name: string }> }>({ queryKey: ["/api/sitespecific/bao/cases/assignees"] });
  const canAssignOthers = assigneeCtx?.canAssignOthers ?? false;
  const selfId = assigneeCtx?.selfId ?? "";
  const assignees = assigneeCtx?.users ?? [];
  const [statusId, setStatusId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [resolutionId, setResolutionId] = useState("");
  const [resolutionYmd, setResolutionYmd] = useState("");
  const [noteTypeId, setNoteTypeId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  useEffect(() => {
    if (!record) return;
    setStatusId(record.statusId); setAssigneeId(record.assigneeUserId); setDeadline(record.deadlineYmd);
    setResolutionId(record.resolutionId ?? ""); setResolutionYmd(record.resolutionYmd ?? "");
  }, [record]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: () => {
      const closed = statuses.find((s) => s.id === statusId)?.closed;
      // Reassignment is explicit: only send assigneeUserId when it actually
      // changed, so lifecycle edits never carry a hidden reassignment.
      const reassigning = assigneeId && assigneeId !== record?.assigneeUserId;
      return apiRequest("PATCH", `/api/sitespecific/bao/cases/${id}`, {
        statusId, deadlineYmd: deadline,
        ...(reassigning ? { assigneeUserId: assigneeId } : {}),
        resolutionId: closed ? resolutionId : null,
        resolutionYmd: closed ? resolutionYmd : null,
      });
    },
    onSuccess: () => { invalidate(); toast({ title: "Case updated" }); },
    onError: (e: Error) => toast({ title: "Update failed", description: getApiErrorMessage(e, "Failed to update case."), variant: "destructive" }),
  });
  const addNote = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sitespecific/bao/cases/${id}/notes`, { typeId: noteTypeId, subject, body: body || null, tagIds }),
    onSuccess: () => { setSubject(""); setBody(""); setTagIds([]); invalidate(); toast({ title: "Comment added" }); },
    onError: (e: Error) => toast({ title: "Comment failed", description: getApiErrorMessage(e, "Failed to add comment."), variant: "destructive" }),
  });
  if (!record) return <div className="p-6">Loading…</div>;
  const nextClosed = statuses.find((s) => s.id === statusId)?.closed ?? record.statusClosed;
  const applicable = noteTypes.filter((t) => t.data?.entityTypes?.includes(record.entityType));
  return (
    <div>
      <PageHeader title={`Case · ${record.entityName ?? record.entityId}`} />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <Card><CardHeader><CardTitle className="flex gap-2">Case Details <Badge>{record.statusName}</Badge></CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div><Label>Created</Label><p>{record.createdAt.slice(0, 10)}</p></div>
            <div><Label>Deadline</Label><Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
            {canAssignOthers
              ? <div><Label>Assignee</Label><Select value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{assignees.map((a) => <SelectItem value={a.id} key={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
              : <div><Label>Assignee</Label><div className="flex items-center gap-2"><p className="text-sm" data-testid="text-assignee-name">{assigneeId === selfId ? "You" : record.assigneeName}</p>{selfId && assigneeId !== selfId && <Button variant="outline" size="sm" data-testid="button-take-case" onClick={() => setAssigneeId(selfId)}>Take this case</Button>}</div></div>}
            <div><Label>Status</Label><Select value={statusId} onValueChange={setStatusId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statuses.map((s) => <SelectItem value={s.id} key={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
            {nextClosed && <><div><Label>Resolution</Label><Select value={resolutionId} onValueChange={setResolutionId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{resolutions.map((r) => <SelectItem value={r.id} key={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Resolution date</Label><Input type="date" value={resolutionYmd} onChange={(e) => setResolutionYmd(e.target.value)} /></div></>}
            <Button onClick={() => save.mutate()} disabled={save.isPending || (nextClosed && (!resolutionId || !resolutionYmd))}>Save</Button>
          </CardContent>
        </Card>
        <CaseLettersCard letters={record.letters ?? []} mailingAddressOnFile={record.mailingAddressOnFile ?? true} isWorkerCase={record.entityType === "worker"} />
        <Card><CardHeader><CardTitle>Conversation</CardTitle></CardHeader><CardContent className="space-y-4">
          {record.notes.map((note) => <div key={note.id} className="rounded border p-3"><div className="font-medium">{note.subject}</div><div className="text-xs text-muted-foreground">{note.typeName} · {note.timestamp.slice(0, 16).replace("T", " ")}{note.authorName ? ` · ${note.authorName}` : ""}</div>{note.body && <p className="mt-2 whitespace-pre-wrap">{note.body}</p>}{(note.tags?.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-1">{note.tags!.map((tag, i) => <Badge variant="outline" key={tag.tagId ?? i}>{tag.tagName ?? tag.name}</Badge>)}</div>}</div>)}
          <div className="space-y-2 border-t pt-4"><Label>Add comment</Label><Select value={noteTypeId} onValueChange={setNoteTypeId}><SelectTrigger><SelectValue placeholder="Note type" /></SelectTrigger><SelectContent>{applicable.map((t) => <SelectItem value={t.id} key={t.id}>{t.name}</SelectItem>)}</SelectContent></Select><Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} /><Textarea value={body} onChange={(e) => setBody(e.target.value)} />{tags.length > 0 && <div className="flex flex-wrap gap-3 rounded border p-3">{tags.map((tag) => <label key={tag.id} className="flex items-center gap-2 text-sm"><Checkbox checked={tagIds.includes(tag.id)} onCheckedChange={(checked) => setTagIds((old) => checked ? [...new Set([...old, tag.id])] : old.filter((tagId) => tagId !== tag.id))} />{tag.name}</label>)}</div>}<Button disabled={!noteTypeId || !subject.trim() || addNote.isPending} onClick={() => addNote.mutate()}>Add Comment</Button></div>
        </CardContent></Card>
      </main>
    </div>
  );
}