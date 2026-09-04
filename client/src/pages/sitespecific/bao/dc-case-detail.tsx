import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarPlus, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDebounced } from "@/hooks/use-debounced";
import { DcDocumentsCard } from "@/components/sitespecific/bao/DcDocumentsCard";
import {
  DcAnnualMaxBadge,
  DcStatusBadge,
  describeDcMonth,
  formatDcHoursLabel,
  formatYmd,
  formatYmdMonthLong,
  formatYmdMonthShort,
  type DcAnnualMaxView,
} from "@/components/sitespecific/bao/dc-shared";
import { DcMonthHistoryList, DcMonthStatesTable } from "@/components/sitespecific/bao/DcMonthStates";
import { formatYmdMonth } from "@shared/utils/date";
import type {
  BaoDcAttestations,
  BaoDcCase,
  BaoDcCaseMonth,
} from "@shared/schema";
import type { DcMonthOption } from "@shared/sitespecific/bao/dc-workflow";
import type { DcCaseMonthState, DcMonthHistoryEntry } from "@shared/sitespecific/bao/dc-reporting";

/** Wait this long after the last month toggle before re-validating. */
const PREVIEW_DEBOUNCE_MS = 300;

type ChecklistItem = { key: string; label: string; satisfied: boolean; detail?: string };

type DocumentRecord = {
  id: string;
  docType: string;
  supersededAt: string | null;
};

type Bundle = {
  case: BaoDcCase;
  months: BaoDcCaseMonth[];
  monthOptions: DcMonthOption[];
  documents: DocumentRecord[];
  readiness: {
    checklist: { items: ChecklistItem[]; passing: boolean };
    ready: boolean;
    missing: string[];
  };
  attestationAuthor: { id: string; name: string } | null;
  yearUsage: Record<string, { used: number; limit: number }>;
  /** Current-year maxed-out state (same derivation as the dashboard list). */
  annualMax?: DcAnnualMaxView;
  /** Per-month state (coverage month, hours, reason) for every case month. */
  monthStates?: DcCaseMonthState[];
  /** Chronological grant/queue/release/reconcile/void log (the auto-log). */
  monthHistory?: DcMonthHistoryEntry[];
  actorNames?: Record<string, string>;
  denialLetters: Array<{ id: string; letterYmd: string; expiresYmd: string }>;
  /** Advisory approval-time configuration preview for the selected months. */
  grantConfigWarnings: Array<{ workMonthYmd: string; code: string; message: string }>;
  isStaff: boolean;
  /** Only designated approvers may approve, deny, or return queued cases. */
  isApprover: boolean;
};

type SelectionValidation = {
  ok: boolean;
  errors: Array<{ code: string; message: string }>;
  gapMonths: string[];
  perYear: Record<string, { used: number; selected: number; limit: number; remaining: number }>;
};

type GrantOutcomeView = {
  monthId: string;
  caseId?: string;
  workMonthYmd: string;
  coverageMonthYmd?: string;
  action: "granted" | "queued" | "removed" | "unchanged";
  grantedHours?: number;
  threshold?: number;
  qualifyingHours?: number;
  reason?: string;
};

type ApprovalWarningView = {
  kind: string;
  caseId: string;
  workMonthYmd: string;
  coverageMonthYmd: string;
  qualifyingHours: number;
  threshold: number;
  message: string;
};

type ActionResult = {
  case?: BaoDcCase;
  nextCaseId?: string | null;
  grant?: GrantOutcomeView[];
  warnings?: ApprovalWarningView[];
};

function describeOutcome(o: GrantOutcomeView): string {
  const month = describeDcMonth({
    workMonthYmd: o.workMonthYmd,
    coverageMonthYmd: o.coverageMonthYmd ?? null,
  });
  switch (o.action) {
    case "granted":
      return `${month}: granted ${formatDcHoursLabel(o.grantedHours ?? 0)}${
        o.threshold !== undefined && o.qualifyingHours !== undefined
          ? ` (${formatDcHoursLabel(o.qualifyingHours)} reported of the ${formatDcHoursLabel(o.threshold)} minimum)`
          : ""
      }`;
    case "queued":
      return `${month}: queued until ${formatYmdMonthShort(o.coverageMonthYmd ?? null)} enters the release window`;
    case "removed":
      return o.reason === "no_shortfall"
        ? `${month}: not credited — hours already meet the minimum; no annual month consumed`
        : `${month}: removed`;
    default:
      return `${month}: unchanged`;
  }
}

export default function BaoDcCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const caseKey = ["/api/sitespecific/bao/dc/cases", caseId];

  const { data, isLoading, error } = useQuery<Bundle>({ queryKey: caseKey });

  const [monthsDraft, setMonthsDraft] = useState<string[] | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [nextCaseId, setNextCaseId] = useState<string | null>(null);
  const [approval, setApproval] = useState<ActionResult | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendReason, setExtendReason] = useState("");

  const activeMonths = useMemo(
    () => (data?.months ?? []).filter((m) => m.status !== "removed"),
    [data],
  );
  const selectedMonths = useMemo(
    () =>
      monthsDraft ?? activeMonths.map((m) => m.workMonthYmd).slice().sort(),
    [monthsDraft, activeMonths],
  );

  const toggleMonth = (monthYmd: string, checked: boolean) => {
    const next = new Set(selectedMonths);
    if (checked) next.add(monthYmd);
    else next.delete(monthYmd);
    setMonthsDraft(Array.from(next).sort());
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: caseKey });

  // The validity preview is keyed off the DEBOUNCED selection: a burst of
  // checkbox clicks asks the server once, after clicking stops, and the last
  // answer stays on screen (keepPreviousData) until the new one arrives —
  // so toggling months never blanks the preview or queues a request per
  // click. The save itself always uses the live `selectedMonths`.
  const previewMonths = useDebounced(selectedMonths, PREVIEW_DEBOUNCE_MS);
  const previewMonthsKey = previewMonths.join(",");
  const preview = useQuery<SelectionValidation>({
    queryKey: ["/api/sitespecific/bao/dc/cases", caseId, "months-preview", previewMonthsKey],
    queryFn: async () =>
      apiRequest("POST", `/api/sitespecific/bao/dc/cases/${caseId}/months/validate`, {
        months: previewMonths,
      }),
    enabled: Boolean(data && data.case.status === "draft" && previewMonths.length > 0),
    placeholderData: keepPreviousData,
  });
  // Dim the preview while it describes an older selection (still within the
  // debounce window, or the new answer is still loading).
  const previewStale =
    previewMonthsKey !== selectedMonths.join(",") || preview.isPlaceholderData || preview.isFetching;

  const saveMonths = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/sitespecific/bao/dc/cases/${caseId}/months`, {
        months: selectedMonths,
      }),
    onSuccess: () => {
      setMonthsDraft(null);
      toast({ title: "Months saved" });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save months",
        description: getApiErrorMessage(err, "Selection is not valid."),
        variant: "destructive",
      }),
  });

  const saveAttestations = useMutation({
    mutationFn: (attestations: BaoDcAttestations) =>
      apiRequest("PUT", `/api/sitespecific/bao/dc/cases/${caseId}/attestations`, attestations),
    onSuccess: (result: { bounced?: boolean }) => {
      if (result?.bounced) {
        toast({
          title: "Case returned to draft",
          description: "Readiness no longer passes after this change.",
        });
      }
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save attestations",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  const act = useMutation({
    mutationFn: (action: string) =>
      apiRequest("POST", `/api/sitespecific/bao/dc/cases/${caseId}/actions`, {
        action,
        reason: actionReason || undefined,
        expectedStatus: data?.case.status,
      }),
    onSuccess: (result: ActionResult, action) => {
      setActionReason("");
      setNextCaseId(result?.nextCaseId ?? null);
      if (action === "approve" && result?.grant) {
        // Per-month outcomes (and any no-shortfall voids) are shown right
        // here, not just "Case updated": approvers must see what was
        // credited, what is queued, and what was voided without consuming
        // an annual month.
        setApproval(result);
        const voided = result.warnings?.length ?? 0;
        toast({
          title: "Case approved",
          description:
            voided > 0
              ? `${voided} selected month(s) needed no credit and were removed — no annual month consumed. See the approval result below.`
              : `${result.grant.filter((g) => g.action === "granted").length} month(s) granted, ${
                  result.grant.filter((g) => g.action === "queued").length
                } queued.`,
        });
      } else {
        setApproval(null);
        toast({ title: "Case updated" });
      }
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/dc/queue"] });
    },
    onError: (err) =>
      toast({
        title: "Action failed",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  const extend = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/sitespecific/bao/dc/cases/${caseId}/extend`, {
        reason: extendReason.trim(),
      }) as Promise<{ case: BaoDcCase }>,
    onSuccess: (result) => {
      setExtendOpen(false);
      setExtendReason("");
      toast({
        title: "Extension request created",
        description: "Select the additional months on the new case.",
      });
      navigate(`/bao/dc/cases/${result.case.id}`);
    },
    onError: (err) =>
      toast({
        title: "Could not create the extension",
        description: getApiErrorMessage(err, "Please try again."),
        variant: "destructive",
      }),
  });

  if (isLoading) return <Skeleton className="h-96 w-full m-6" />;
  if (error || !data) {
    return (
      <p className="p-6 text-sm text-destructive" data-testid="text-dc-case-error">
        {getApiErrorMessage(error, "Could not load the case.")}
      </p>
    );
  }

  const c = data.case;
  const att = (c.attestations ?? {}) as BaoDcAttestations;
  const setAtt = (patch: Partial<BaoDcAttestations>) =>
    saveAttestations.mutate({
      dcFormOnFile: att.dcFormOnFile,
      signed: att.signed,
      restrictionsNoted: att.restrictionsNoted,
      fields: att.fields,
      ...patch,
    });

  const isDraft = c.status === "draft";
  const terminal = ["denied", "withdrawn", "void"].includes(c.status);
  // The manual "DC form on file" attestation only appears once a CURRENT
  // document is classified as a DC form — upload alone never attests.
  const hasCurrentDcForm = (data.documents ?? []).some(
    (d) => d.docType === "dc_form" && !d.supersededAt,
  );
  const isExtension = Boolean((c.data as any)?.extensionOfCaseId);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/workers/${c.workerId}/sitespecific/bao/disability-credit`}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Worker
            </Link>
          </Button>
          <h1 className="text-xl font-semibold" data-testid="text-dc-case-title">
            Disability Credit case — opened {formatYmd(c.openedYmd)}
          </h1>
          <DcStatusBadge status={c.status} />
          {isExtension && (
            <Badge variant="secondary" data-testid="badge-dc-extension">
              Extension of{" "}
              <Link
                href={`/bao/dc/cases/${(c.data as any).extensionOfCaseId}`}
                className="underline ml-1"
              >
                original case
              </Link>
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center justify-end">
          {Object.entries(data.yearUsage)
            .sort()
            .map(([year, usage]) => (
              <Badge key={year} variant="outline" data-testid={`badge-dc-case-usage-${year}`}>
                {year}: {usage.used} of {usage.limit} used
              </Badge>
            ))}
          <DcAnnualMaxBadge annualMax={data.annualMax} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qualifying basis (at open)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(c.qualifyingBasis?.conditions ?? []).map((cond: string) => (
            <Badge key={cond} variant="secondary" data-testid={`badge-dc-basis-${cond}`}>
              {cond === "fmla_months"
                ? `FMLA months: ${((c.qualifyingBasis as any)?.fmlaMonths ?? [])
                    .map((m: string) => formatYmdMonth(m))
                    .join(", ")}`
                : cond === "staff_exception"
                  ? "Staff exception"
                  : "Active denial letter"}
            </Badge>
          ))}
          {(c.qualifyingBasis as any)?.exceptionReason && (
            <p
              className="w-full text-sm text-muted-foreground"
              data-testid="text-dc-exception-reason"
            >
              Exception reason: {(c.qualifyingBasis as any).exceptionReason}
            </p>
          )}
          {data.denialLetters.map((l) => (
            <Badge key={l.id} variant="outline">
              Letter {formatYmd(l.letterYmd)} — expires {formatYmd(l.expiresYmd)}
            </Badge>
          ))}
        </CardContent>
      </Card>

      {nextCaseId && (
        <Card data-testid="card-dc-next-case">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <p className="text-sm">Another case is waiting in the approval queue.</p>
            <Button
              onClick={() => {
                setNextCaseId(null);
                navigate(`/bao/dc/cases/${nextCaseId}`);
              }}
              data-testid="button-dc-next-case"
            >
              Go to next case <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      )}

      {approval?.grant && (
        <Card
          className="border-green-600/50 dark:border-green-500/40"
          data-testid="card-dc-approval-result"
        >
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Approval result
            </CardTitle>
            <CardDescription>
              What happened to each selected coverage month when this case was approved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(approval.warnings ?? []).map((w) => (
              <p
                key={w.workMonthYmd}
                className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2"
                data-testid={`text-dc-approval-warning-${w.workMonthYmd.slice(0, 7)}`}
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{w.message}</span>
              </p>
            ))}
            <ul className="text-sm space-y-1">
              {approval.grant.map((o) => (
                <li
                  key={o.monthId}
                  data-testid={`text-dc-approval-outcome-${o.workMonthYmd.slice(0, 7)}`}
                >
                  {describeOutcome(o)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data.isStaff && (data.grantConfigWarnings ?? []).length > 0 && (
        <Card
          className="border-amber-500/60 dark:border-amber-500/40"
          data-testid="card-dc-grant-config-warnings"
        >
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Benefit-rule configuration problem
            </CardTitle>
            <CardDescription>
              Approving this case would fail for the months below until the
              eligibility configuration is fixed. This does not affect the
              readiness checklist or queueing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.grantConfigWarnings.map((w) => (
              <p
                key={w.workMonthYmd}
                className="text-sm"
                data-testid={`text-dc-grant-warning-${w.workMonthYmd.slice(0, 7)}`}
              >
                <span className="font-medium">Work month {formatYmdMonthLong(w.workMonthYmd)}:</span>{" "}
                {w.message}.
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Documents come FIRST — review is document-driven. */}
      <DcDocumentsCard caseId={caseId} canSupersede canSetType onEvidenceChange={invalidate} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Readiness checklist</CardTitle>
          <CardDescription>
            {data.readiness.ready
              ? "All checklist items pass."
              : `Missing: ${data.readiness.missing.join("; ")}`}
            {data.attestationAuthor && (
              <span className="block" data-testid="text-dc-attestation-author">
                Attestations completed by {data.attestationAuthor.name}
                {att.updatedAt ? ` on ${formatYmd(att.updatedAt.slice(0, 10))}` : ""}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.readiness.checklist.items.map((item) => (
            <div key={item.key} className="flex items-center gap-2" data-testid={`checklist-${item.key}`}>
              {item.satisfied ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" />
              )}
              <span className="text-sm">{item.label}</span>
              {item.detail && (
                <span className="text-xs text-muted-foreground">({item.detail})</span>
              )}
            </div>
          ))}
          {!terminal && c.status !== "approved" && (
            <div className="pt-3 border-t mt-3 grid gap-2 sm:grid-cols-2">
              {hasCurrentDcForm && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={att.dcFormOnFile === true}
                    onCheckedChange={(v) => setAtt({ dcFormOnFile: v === true })}
                    data-testid="checkbox-dc-att-dcFormOnFile"
                  />
                  DC form on file (verified against the classified document)
                </label>
              )}
              {[
                { key: "signed", label: "Form is doctor-signed", value: att.signed === true },
                {
                  key: "restrictionsNoted",
                  label: "Restrictions noted (requires employer letter)",
                  value: att.restrictionsNoted === true,
                },
              ].map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={f.value}
                    onCheckedChange={(v) => setAtt({ [f.key]: v === true } as any)}
                    data-testid={`checkbox-dc-att-${f.key}`}
                  />
                  {f.label}
                </label>
              ))}
              {(
                [
                  ["doctorAddress", "Doctor address present"],
                  ["doctorPhone", "Doctor phone present"],
                  ["dates", "Dates present"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={att.fields?.[key] === true}
                    onCheckedChange={(v) =>
                      setAtt({ fields: { ...att.fields, [key]: v === true } })
                    }
                    data-testid={`checkbox-dc-att-field-${key}`}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coverage months</CardTitle>
          <CardDescription>
            {isDraft ? (
              <>
                Choose the <strong>coverage months</strong> the Fund is approving. Each
                coverage month is earned by an earlier <strong>work month</strong> (coverage
                month minus the plan&apos;s lag); Disability Credit hours are credited to that
                work month under the Fund/DC employer, and only the shortfall between the hours
                already reported and the plan minimum is added. Months whose reported hours
                already meet the minimum need no credit and are offered as not grantable.
                Continuity gaps and annual capacity are checked on the coverage axis before save;
                unavailable months explain why.
              </>
            ) : (
              "Months can only be changed while the case is in draft."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(isDraft || (data.monthStates ?? []).length === 0) && (
            <div
              role="group"
              aria-label="Disability Credit coverage months"
              className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3"
            >
              {(data.monthOptions ?? []).map((opt) => {
                const checked = selectedMonths.includes(opt.workMonthYmd);
                const disabled = !isDraft || (!opt.selectable && !checked);
                const label = describeDcMonth(opt);
                return (
                  <label
                    key={opt.workMonthYmd}
                    className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                      disabled ? "opacity-60" : "hover-elevate cursor-pointer"
                    }`}
                    data-testid={`option-dc-month-${opt.workMonthYmd.slice(0, 7)}`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(v) => toggleMonth(opt.workMonthYmd, v === true)}
                      aria-label={label}
                      data-testid={`checkbox-dc-month-${opt.workMonthYmd.slice(0, 7)}`}
                    />
                    <span className="space-y-0.5">
                      {opt.coverageMonthYmd ? (
                        <>
                          <span className="block leading-none font-medium">
                            {formatYmdMonthLong(opt.coverageMonthYmd)} coverage
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            hours credited to {formatYmdMonthShort(opt.workMonthYmd)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="block leading-none font-medium">
                            Work month {formatYmdMonthLong(opt.workMonthYmd)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            coverage month unresolved
                          </span>
                        </>
                      )}
                      {opt.detail && (
                        <span
                          className="block text-xs"
                          data-testid={`text-dc-month-detail-${opt.workMonthYmd.slice(0, 7)}`}
                        >
                          {opt.detail}
                        </span>
                      )}
                      {opt.reason && (
                        <span className="block text-xs text-muted-foreground">{opt.reason}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {isDraft && (
            <Button
              onClick={() => saveMonths.mutate()}
              disabled={!isDraft || saveMonths.isPending || monthsDraft === null}
              data-testid="button-dc-save-months"
            >
              Save months
            </Button>
          )}
          {isDraft && selectedMonths.length > 0 && preview.data && (
            <div
              className={`text-sm space-y-1 ${previewStale ? "opacity-60" : ""}`}
              aria-busy={previewStale}
              data-testid="text-dc-months-preview"
            >
              {preview.data.ok ? (
                <p className="text-green-700 dark:text-green-400">Selection is valid.</p>
              ) : (
                preview.data.errors.map((e, i) => (
                  <p key={i} className="text-red-700 dark:text-red-400">
                    {e.message}
                  </p>
                ))
              )}
              {Object.entries(preview.data.perYear).map(([year, u]) => (
                <p key={year} className="text-muted-foreground">
                  {year}: {u.used} used + {u.selected} selected of {u.limit} ({u.remaining}{" "}
                  remaining{u.remaining <= 0 ? " — annual maximum reached" : ""})
                </p>
              ))}
            </div>
          )}
          {(data.monthStates ?? []).length > 0 && (
            <div className="space-y-2 pt-2" data-testid="section-dc-month-states">
              <h3 className="text-sm font-medium">Month states</h3>
              <DcMonthStatesTable states={data.monthStates ?? []} />
            </div>
          )}
        </CardContent>
      </Card>

      {(data.monthHistory ?? []).length > 0 && (
        <Card data-testid="card-dc-month-history">
          <CardHeader>
            <CardTitle className="text-base">Disability Credit log</CardTitle>
            <CardDescription>
              Automatically recorded, in order: every grant, queue, release, reconciliation and
              void with the credited hours before and after. Entries cannot be edited.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DcMonthHistoryList
              history={data.monthHistory ?? []}
              actorNames={data.actorNames ?? {}}
            />
          </CardContent>
        </Card>
      )}

      {!terminal && c.status !== "approved" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Reason (required for deny/withdraw, recorded for bounce)…"
              data-testid="input-dc-action-reason"
            />
            <div className="flex flex-wrap gap-2">
              {(c.status === "draft" || c.status === "ready_for_review") && (
                <Button
                  onClick={() => act.mutate("send_for_approval")}
                  disabled={act.isPending || !data.readiness.ready}
                  data-testid="button-dc-send-for-approval"
                >
                  Send for Approval
                </Button>
              )}
              {c.status === "ready_for_review" && (
                <Button variant="outline" onClick={() => act.mutate("bounce")} disabled={act.isPending} data-testid="button-dc-bounce">
                  Return to draft
                </Button>
              )}
              {c.status === "in_queue" &&
                (data.isApprover ? (
                  <>
                    <Button onClick={() => act.mutate("approve")} disabled={act.isPending} data-testid="button-dc-approve">
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => act.mutate("deny")}
                      disabled={act.isPending || !actionReason.trim()}
                      data-testid="button-dc-deny"
                    >
                      Deny
                    </Button>
                    <Button variant="outline" onClick={() => act.mutate("bounce")} disabled={act.isPending} data-testid="button-dc-bounce">
                      Return to draft
                    </Button>
                  </>
                ) : (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="text-dc-approver-required"
                  >
                    This case is in the approval queue. Only designated
                    Disability Credit approvers can approve, deny, or return it.
                  </p>
                ))}
              <Button
                variant="outline"
                onClick={() => act.mutate("withdraw")}
                disabled={act.isPending || !actionReason.trim()}
                data-testid="button-dc-withdraw"
              >
                Withdraw
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {c.status === "approved" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extend disability</CardTitle>
            <CardDescription>
              Record an auditable extension request — a new linked case routed
              through review and approval. This case stays approved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setExtendOpen(true)} data-testid="button-dc-extend">
              <CalendarPlus className="h-4 w-4 mr-2" /> Extend disability
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend disability</DialogTitle>
            <DialogDescription>
              A reason is required. The extension opens as a new draft case where
              you select the eligible additional months; it goes through the
              normal review and approval queue.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={extendReason}
            onChange={(e) => setExtendReason(e.target.value)}
            placeholder="Reason for the extension (required)…"
            data-testid="input-dc-extend-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => extend.mutate()}
              disabled={extend.isPending || !extendReason.trim()}
              data-testid="button-dc-extend-confirm"
            >
              Create extension request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
