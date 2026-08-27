import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarClock, FilePlus2, ShieldCheck } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BaoDcCase } from "@shared/schema";
import { DcStatusBadge, formatYmd } from "@/components/sitespecific/bao/dc-shared";
import { DcMemberCasePanel } from "@/components/sitespecific/bao/DcMemberCasePanel";

type WorkerDcResponse = {
  eligibility: {
    eligible: boolean;
    conditions: string[];
    fmlaMonthsInWindow: string[];
    activeDenialLetterIds: string[];
  };
  cases: BaoDcCase[];
  hasOpenCase: boolean;
  yearUsage: Record<string, { used: number; limit: number }>;
  isStaff: boolean;
};

function WorkerDcContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading, error } = useQuery<WorkerDcResponse>({
    queryKey: ["/api/workers", worker.id, "sitespecific/bao/dc"],
  });

  const openCase = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      apiRequest("POST", `/api/workers/${worker.id}/sitespecific/bao/dc/cases`, {
        confirmDuplicate,
      }),
    onSuccess: () => {
      setConfirmOpen(false);
      toast({ title: "Disability Credit case opened" });
      queryClient.invalidateQueries({
        queryKey: ["/api/workers", worker.id, "sitespecific/bao/dc"],
      });
    },
    onError: (err) =>
      toast({
        title: "Could not open case",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  // Member document-first intake: one submission uploads the form and, when
  // needed, opens the case atomically (or adds to the existing open case).
  const intakeInput = useRef<HTMLInputElement>(null);
  const intake = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/workers/${worker.id}/sitespecific/bao/dc/intake`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Submission failed");
      }
      return res.json() as Promise<{ created: boolean }>;
    },
    onSuccess: (result) => {
      toast({
        title: result.created
          ? "Case started — your document was submitted"
          : "Document added to your open case",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/workers", worker.id, "sitespecific/bao/dc"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/dc/cases"] });
    },
    onError: (err) =>
      toast({
        title: "Could not submit document",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full" data-testid="skeleton-dc" />;
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive" data-testid="text-dc-error">
        {getApiErrorMessage(error, "Could not load Disability Credit information.")}
      </p>
    );
  }

  const startCase = () => {
    if (data.hasOpenCase) {
      setConfirmOpen(true);
    } else {
      openCase.mutate(false);
    }
  };

  const caseHref = (c: BaoDcCase) =>
    data.isStaff
      ? `/bao/dc/cases/${c.id}`
      : `/workers/${worker.id}/sitespecific/bao/disability-credit`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Disability Credit
            </CardTitle>
            <CardDescription>
              {data.eligibility.eligible
                ? "Currently eligible to open a Disability Credit case."
                : "Not currently eligible to open a new case."}
            </CardDescription>
          </div>
          {data.isStaff && data.eligibility.eligible && (
            <Button
              onClick={startCase}
              disabled={openCase.isPending}
              data-testid="button-start-dc-case"
            >
              <FilePlus2 className="h-4 w-4 mr-2" /> Start case
            </Button>
          )}
          {!data.isStaff && (data.eligibility.eligible || data.hasOpenCase) && (
            <>
              <input
                ref={intakeInput}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) intake.mutate(file);
                  e.target.value = "";
                }}
                data-testid="input-dc-intake-file"
              />
              <Button
                onClick={() => intakeInput.current?.click()}
                disabled={intake.isPending}
                data-testid="button-dc-intake-submit"
              >
                <FilePlus2 className="h-4 w-4 mr-2" />
                {data.hasOpenCase ? "Add a document" : "Submit disability form"}
              </Button>
            </>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2" data-testid="text-dc-qualifying-basis">
            {data.eligibility.conditions.includes("fmla_months") && (
              <Badge variant="secondary">
                Qualifies via FMLA months (
                {data.eligibility.fmlaMonthsInWindow.map((m) => formatYmd(m).slice(0, 7)).join(", ")}
                )
              </Badge>
            )}
            {data.eligibility.conditions.includes("denial_letter") && (
              <Badge variant="secondary">Qualifies via active denial letter</Badge>
            )}
            {!data.eligibility.eligible && (
              <span className="text-sm text-muted-foreground">
                Eligibility requires 3 FMLA months in the last 12 months or an active
                denial letter.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-5 w-5" /> Annual usage
          </CardTitle>
          <CardDescription>
            Disability Credit months used per year (removed months excluded).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(data.yearUsage).length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-dc-usage-empty">
              No Disability Credit months yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {Object.entries(data.yearUsage)
                .sort()
                .map(([year, usage]) => (
                  <Badge key={year} variant="outline" data-testid={`badge-dc-usage-${year}`}>
                    {year}: {usage.used} of {usage.limit} used
                  </Badge>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cases</CardTitle>
        </CardHeader>
        <CardContent>
          {data.cases.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-dc-cases-empty">
              No Disability Credit cases.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opened</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.cases.map((c) => (
                  <TableRow key={c.id} data-testid={`row-dc-case-${c.id}`}>
                    <TableCell>{formatYmd(c.openedYmd)}</TableCell>
                    <TableCell>
                      <DcStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(c.qualifyingBasis?.conditions ?? [])
                        .map((cond: string) =>
                          cond === "fmla_months" ? "FMLA months" : "Denial letter",
                        )
                        .join(", ")}
                    </TableCell>
                    <TableCell className="text-right">
                      {data.isStaff ? (
                        <Button asChild variant="outline" size="sm" data-testid={`link-dc-case-${c.id}`}>
                          <Link href={caseHref(c)}>Open</Link>
                        </Button>
                      ) : (
                        <MemberCasePanelToggle caseId={c.id} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <MemberCasePanels cases={data.cases} isStaff={data.isStaff} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open a second case?</AlertDialogTitle>
            <AlertDialogDescription>
              This worker already has an open Disability Credit case. Opening another
              one is unusual — continue only if this is intentional.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-duplicate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => openCase.mutate(true)}
              data-testid="button-confirm-duplicate"
            >
              Open second case
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Member view: the case panel lives inline on this tab (document submission
// + read-only status), since members do not have access to the staff case
// screens.
function MemberCasePanelToggle({ caseId }: { caseId: string }) {
  return (
    <a href={`#dc-case-${caseId}`} className="text-sm underline text-muted-foreground">
      Details below
    </a>
  );
}

function MemberCasePanels({ cases, isStaff }: { cases: BaoDcCase[]; isStaff: boolean }) {
  if (isStaff) return null;
  return (
    <div className="space-y-6">
      {cases.map((c) => (
        <div key={c.id} id={`dc-case-${c.id}`}>
          <DcMemberCasePanel caseId={c.id} />
        </div>
      ))}
    </div>
  );
}

export default function WorkerBaoDcPage() {
  return (
    <WorkerLayout activeTab="sitespecific-bao-dc">
      <WorkerDcContent />
    </WorkerLayout>
  );
}
