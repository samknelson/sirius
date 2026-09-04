import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { format } from "@/lib/date-format";
import { useToast } from "@/hooks/use-toast";
import { useModalSeed } from "@/hooks/use-modal-seed";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** A case status option as `/api/options/bao-case-status` returns it. */
export interface CaseStatusOption {
  id: string;
  name: string;
  closed?: boolean;
  caseTypeId?: string | null;
  workflowStep?: string | null;
  defaultResolutionId?: string | null;
}

export interface NamedOption {
  id: string;
  name: string;
  data?: { contextIds?: string[] };
}

interface EligibilityPlugin {
  id: string;
  name: string;
  description: string;
}

/** What the card needs from the case detail record. */
export interface AppealOutcomeCase {
  id: string;
  entityType: string;
  entityName: string | null;
  caseTypeId?: string | null;
  createdAt: string;
  benefitName?: string | null;
  denialReasonName?: string | null;
  denialReasonEligibilityPluginIds?: string[];
}

interface Props {
  record: AppealOutcomeCase;
  statuses: CaseStatusOption[];
  resolutions: NamedOption[];
  noteTypes: NamedOption[];
  tags: NamedOption[];
  /** Invalidate/refetch whatever shows the case after an outcome is recorded. */
  onRecorded: () => void;
}

interface OutcomeResult {
  case: { id: string; statusId: string };
  exemptionId: string | null;
  exemptionCreated: boolean | null;
}

const NO_NOTE = "__none__";

function todayYmd(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * The trustees' outcome on a Benefit Appeal in Trustee Review: Approve (grant
 * a never-ending exemption for the appealed benefit and close the case as
 * approved) or Deny (close the case as denied, optionally with a closing
 * note). Both are server transactions; this card only collects the choices.
 */
export function AppealOutcomeCard({ record, statuses, resolutions, noteTypes, tags, onRecorded }: Props) {
  const { toast } = useToast();
  const [openDialog, setOpenDialog] = useState<"approve" | "deny" | null>(null);
  const targetFor = (step: "approved" | "denied") =>
    statuses.find((s) => s.workflowStep === step && (!record.caseTypeId || s.caseTypeId === record.caseTypeId));
  const approvedStatus = targetFor("approved");
  const deniedStatus = targetFor("denied");

  // Approve form
  // Staff-readable list of the checks an approval may waive (the plugin
  // manifest itself is admin-only).
  const { data: checkOptions, isLoading: pluginsLoading } = useQuery<{ checks: EligibilityPlugin[] }>({
    queryKey: ["/api/sitespecific/bao/cases/appeal-checks"],
  });
  const plugins = checkOptions?.checks ?? [];
  const [checks, setChecks] = useState<string[]>([]);
  const [startYmd, setStartYmd] = useState("");
  const [approveResolutionId, setApproveResolutionId] = useState("");
  const [approveResolutionYmd, setApproveResolutionYmd] = useState("");
  const configured = record.denialReasonEligibilityPluginIds ?? [];
  const available = new Set(plugins.map((p) => p.id));
  const unavailable = configured.filter((id) => !available.has(id));
  useModalSeed(
    openDialog === "approve",
    `${record.id}:${plugins.map((p) => p.id).join(",")}:${configured.join(",")}:${approvedStatus?.id ?? ""}`,
    () => {
      setChecks(configured.filter((id) => available.has(id)));
      setStartYmd(format(record.createdAt, "yyyy-MM-01"));
      setApproveResolutionId(approvedStatus?.defaultResolutionId ?? "");
      setApproveResolutionYmd(todayYmd());
    },
  );

  // Deny form
  const [noteTypeId, setNoteTypeId] = useState(NO_NOTE);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [denyResolutionId, setDenyResolutionId] = useState("");
  const [denyResolutionYmd, setDenyResolutionYmd] = useState("");
  useModalSeed(openDialog === "deny", `${record.id}:${deniedStatus?.id ?? ""}`, () => {
    setNoteTypeId(NO_NOTE);
    setSubject("");
    setBody("");
    setTagIds([]);
    setDenyResolutionId(deniedStatus?.defaultResolutionId ?? "");
    setDenyResolutionYmd(todayYmd());
  });
  const applicableNoteTypes = noteTypes.filter((t) => t.data?.contextIds?.includes(record.entityType));
  const withNote = noteTypeId !== NO_NOTE;

  const finish = (title: string, description?: string) => {
    setOpenDialog(null);
    onRecorded();
    toast({ title, description });
  };
  const approve = useMutation({
    mutationFn: async (): Promise<OutcomeResult> =>
      apiRequest("POST", `/api/sitespecific/bao/cases/${record.id}/approve`, {
        eligibilityPlugins: checks,
        startYmd,
        ...(approveResolutionId ? { resolutionId: approveResolutionId } : {}),
        ...(approveResolutionYmd ? { resolutionYmd: approveResolutionYmd } : {}),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      finish(
        "Appeal approved",
        result.exemptionCreated === false
          ? "An equivalent exemption already existed and was reused."
          : "The exemption has been created.",
      );
    },
    onError: (e: Error) =>
      toast({ title: "Could not approve appeal", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" }),
  });
  const deny = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/sitespecific/bao/cases/${record.id}/deny`, {
        ...(withNote ? { note: { typeId: noteTypeId, subject, body: body || null, ...(tagIds.length ? { tagIds } : {}) } } : {}),
        ...(denyResolutionId ? { resolutionId: denyResolutionId } : {}),
        ...(denyResolutionYmd ? { resolutionYmd: denyResolutionYmd } : {}),
      }),
    onSuccess: () => finish("Appeal denied", "The case is closed as denied."),
    onError: (e: Error) =>
      toast({ title: "Could not deny appeal", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" }),
  });

  const toggle = (setter: (fn: (old: string[]) => string[]) => void, id: string, checked: boolean) =>
    setter((old) => (checked ? [...new Set([...old, id])] : old.filter((x) => x !== id)));
  const benefit = record.benefitName ?? "the appealed benefit";
  const member = record.entityName ?? "the member";
  const approveDisabled = approve.isPending || checks.length === 0 || !startYmd || !approveResolutionId || !approveResolutionYmd;
  const denyDisabled = deny.isPending || !denyResolutionId || !denyResolutionYmd || (withNote && !subject.trim());

  return (
    <Card data-testid="card-appeal-outcome">
      <CardHeader>
        <CardTitle>Trustee outcome</CardTitle>
        <CardDescription>
          Record the trustees’ decision on this appeal. Approving grants {member} a never-ending exemption for {benefit} and
          closes the case as approved; denying closes it as denied.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button data-testid="button-approve-appeal" onClick={() => setOpenDialog("approve")} disabled={!approvedStatus}>
          Approve
        </Button>
        <Button data-testid="button-deny-appeal" variant="destructive" onClick={() => setOpenDialog("deny")} disabled={!deniedStatus}>
          Deny
        </Button>
        {(!approvedStatus || !deniedStatus) && (
          <p className="w-full text-sm text-destructive" data-testid="text-outcome-status-missing">
            The Benefit Appeal workflow is missing its {!approvedStatus ? "Approved" : "Closed–Denied"} status; ask an administrator to configure it.
          </p>
        )}
      </CardContent>

      <Dialog open={openDialog === "approve"} onOpenChange={(open) => !open && setOpenDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve appeal</DialogTitle>
            <DialogDescription>
              Creates an exemption for {member}’s {benefit} that never ends, waiving the checks below from the start date, and
              moves the case to {approvedStatus?.name ?? "Approved"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Eligibility checks to exempt</Label>
              {pluginsLoading ? (
                <p className="text-sm text-muted-foreground">Loading checks…</p>
              ) : plugins.length === 0 ? (
                <p className="text-sm text-destructive">No eligibility checks are available.</p>
              ) : (
                <div className="max-h-56 space-y-2 overflow-y-auto rounded border p-3">
                  {plugins.map((plugin) => (
                    <label key={plugin.id} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        data-testid={`checkbox-exempt-${plugin.id}`}
                        checked={checks.includes(plugin.id)}
                        onCheckedChange={(checked) => toggle(setChecks, plugin.id, checked === true)}
                      />
                      <span>
                        <span className="font-medium">{plugin.name}</span>
                        {plugin.description && <span className="block text-muted-foreground">{plugin.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {configured.length > 0
                  ? `Pre-selected from the denial reason${record.denialReasonName ? ` “${record.denialReasonName}”` : ""}.`
                  : "The denial reason has no checks configured; select the checks the trustees waived."}
                {unavailable.length > 0 && ` Not available here: ${unavailable.join(", ")}.`}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="approve-start">Exemption starts</Label>
                <Input id="approve-start" data-testid="input-exemption-start" type="date" value={startYmd} onChange={(e) => setStartYmd(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">Defaults to the first day of the month the appeal was opened. No end date.</p>
              </div>
              <div>
                <Label>Resolution</Label>
                <Select value={approveResolutionId} onValueChange={setApproveResolutionId}>
                  <SelectTrigger data-testid="select-approve-resolution"><SelectValue placeholder="Resolution" /></SelectTrigger>
                  <SelectContent>{resolutions.map((r) => <SelectItem value={r.id} key={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="approve-resolution-date">Resolution date</Label>
                <Input id="approve-resolution-date" data-testid="input-approve-resolution-date" type="date" value={approveResolutionYmd} onChange={(e) => setApproveResolutionYmd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(null)} disabled={approve.isPending}>Cancel</Button>
            <Button data-testid="button-confirm-approve" onClick={() => approve.mutate()} disabled={approveDisabled}>
              {approve.isPending ? "Approving…" : "Approve and grant exemption"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openDialog === "deny"} onOpenChange={(open) => !open && setOpenDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Deny appeal</DialogTitle>
            <DialogDescription>
              Moves the case to {deniedStatus?.name ?? "Closed – Denied"}. A closing note is optional and joins the case conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Resolution</Label>
                <Select value={denyResolutionId} onValueChange={setDenyResolutionId}>
                  <SelectTrigger data-testid="select-deny-resolution"><SelectValue placeholder="Resolution" /></SelectTrigger>
                  <SelectContent>{resolutions.map((r) => <SelectItem value={r.id} key={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="deny-resolution-date">Resolution date</Label>
                <Input id="deny-resolution-date" data-testid="input-deny-resolution-date" type="date" value={denyResolutionYmd} onChange={(e) => setDenyResolutionYmd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Closing note (optional)</Label>
              <Select value={noteTypeId} onValueChange={setNoteTypeId}>
                <SelectTrigger data-testid="select-deny-note-type"><SelectValue placeholder="Note type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_NOTE}>No closing note</SelectItem>
                  {applicableNoteTypes.map((t) => <SelectItem value={t.id} key={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {withNote && (
                <>
                  <Input data-testid="input-deny-note-subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                  <Textarea data-testid="input-deny-note-body" placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} />
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-3 rounded border p-3">
                      {tags.map((tag) => (
                        <label key={tag.id} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={tagIds.includes(tag.id)} onCheckedChange={(checked) => toggle(setTagIds, tag.id, checked === true)} />
                          {tag.name}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(null)} disabled={deny.isPending}>Cancel</Button>
            <Button data-testid="button-confirm-deny" variant="destructive" onClick={() => deny.mutate()} disabled={denyDisabled}>
              {deny.isPending ? "Denying…" : "Deny appeal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
