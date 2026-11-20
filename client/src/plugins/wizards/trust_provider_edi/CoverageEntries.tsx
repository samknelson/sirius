import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/queryClient";
import {
  EDI_COVERAGE_REASONS, type EdiCoverageConflict, type EdiCoverageEntry, type EdiCoverageEntryReason,
  type EdiCoverageRule, type EdiCoverageRunSummary,
} from "@shared/edi-coverage-choices";
import { downloadStepExport } from "./use-coverage-review";

const PAGE = 25;

export const RULE_TEXT: Record<EdiCoverageRule, string> = {
  "exclude-conflicting": "Temporary rule: conflicting coverage is left out of the file and listed here.",
  "refuse-conflicting": "Conflicting coverage stops the run. Nothing is left out of the file.",
};

export function formatWhen(value?: string) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? value ?? "" : date.toLocaleString();
}

/** A feed run's entry, or a conflict listed outside any run (no kind, no reason). */
type Listed = EdiCoverageConflict & Partial<Pick<EdiCoverageEntry, "kind" | "reason">>;

function Entry({ entry, personHref }: { entry: Listed; personHref?: (workerId: string) => string }) {
  const reason = entry.reason && EDI_COVERAGE_REASONS[entry.reason];
  return <li className="rounded-md border p-4" data-testid={`coverage-entry-${entry.workerId}-${entry.benefitId}-${entry.month}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="min-w-0 break-words font-medium">
        {personHref
          ? <Link href={personHref(entry.workerId)} className="text-primary hover:underline">{entry.personLabel}</Link>
          : entry.personLabel} · {entry.benefitLabel} · {entry.month}
      </p>
      {reason && <Badge variant={entry.kind === "exclusion" ? "destructive" : "outline"}>{reason.label}</Badge>}
    </div>
    {reason && <p className="mt-1 text-sm text-muted-foreground">{reason.meaning}</p>}
    <p className="mt-1 break-all text-xs text-muted-foreground">Person ID {entry.workerId} · Benefit ID {entry.benefitId}</p>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pr-4 font-medium">Coverage record ID</th>
            <th scope="col" className="py-1 pr-4 font-medium">Employer</th>
            <th scope="col" className="py-1 pr-4 font-medium">Source</th>
            <th scope="col" className="py-1 font-medium">COBRA</th>
          </tr>
        </thead>
        <tbody>
          {entry.records.map(record => <tr key={record.id} className="border-t align-top">
            <td className="break-all py-2 pr-4 font-mono text-xs">{record.id}</td>
            <td className="py-2 pr-4">{record.employerLabel}
              <span className="block break-all text-xs text-muted-foreground">
                {record.employerSiriusId ? `Sirius ID ${record.employerSiriusId}` : `ID ${record.employerId}`}
              </span>
            </td>
            <td className="py-2 pr-4">{record.sourceRelationId
              ? <>Dependent of {record.subscriberLabel}
                <span className="block break-all text-xs text-muted-foreground">Relationship {record.sourceRelationId}</span></>
              : "Subscriber (own coverage)"}
            </td>
            <td className="py-2">{record.isCobra ? "COBRA" : "Non-COBRA"}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </li>;
}

/** Paged and filterable, so a long list stays reviewable. */
export function CoverageEntryList({ title, entries, total, empty, personHref }: {
  title: string; entries: Listed[]; total: number; empty: string;
  /** When given, each person's name links there. */
  personHref?: (workerId: string) => string;
}) {
  const [reason, setReason] = useState<EdiCoverageEntryReason | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const reasons = useMemo(() => [...new Set(entries.map(entry => entry.reason)
    .filter((value): value is EdiCoverageEntryReason => !!value))], [entries]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter(entry => (!reason || entry.reason === reason) && (!needle ||
      [entry.personLabel, entry.workerId, entry.benefitLabel, entry.month, ...entry.records.map(r => r.id)]
        .some(value => value.toLowerCase().includes(needle))));
  }, [entries, reason, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const id = title.toLowerCase().replace(/\W+/g, "-");
  return <section aria-label={title} className="space-y-3">
    <h3 className="text-base font-medium">{title} ({total})</h3>
    {!total && <p className="text-sm text-muted-foreground">{empty}</p>}
    {total > entries.length && <p role="status" className="rounded-md bg-muted/50 p-3 text-sm">
      Showing the first {entries.length} of {total}. The download contains every entry.
    </p>}
    {entries.length > PAGE && <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor={`${id}-search`}>Find a person, month or record ID</Label>
        <Input id={`${id}-search`} value={search} className="w-72"
          onChange={event => { setSearch(event.target.value); setPage(0); }} />
      </div>
      {reasons.length > 1 && <div className="space-y-1">
        <Label htmlFor={`${id}-reason`}>Reason</Label>
        <select id={`${id}-reason`} value={reason} className="block rounded-md border bg-background px-3 py-2 text-sm"
          onChange={event => { setReason(event.target.value as EdiCoverageEntryReason | ""); setPage(0); }}>
          <option value="">All reasons</option>
          {reasons.map(value => <option key={value} value={value}>{EDI_COVERAGE_REASONS[value].label}</option>)}
        </select>
      </div>}
    </div>}
    {!!entries.length && !filtered.length && <p className="text-sm text-muted-foreground">No entries match this filter.</p>}
    <ul className="space-y-3">
      {filtered.slice(current * PAGE, current * PAGE + PAGE).map(entry =>
        <Entry key={`${entry.reason ?? ""}|${entry.workerId}|${entry.benefitId}|${entry.month}`} entry={entry} personHref={personHref} />)}
    </ul>
    {pages > 1 && <div className="flex items-center gap-3 text-sm">
      <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
      <span role="status">Page {current + 1} of {pages}</span>
      <Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
    </div>}
  </section>;
}

export function ExclusionDownload({ wizardId, stepId, label = "Download exclusion list" }: {
  wizardId: string; stepId: "coverage" | "deliver"; label?: string;
}) {
  const download = useMutation({ mutationFn: () => downloadStepExport(wizardId, stepId, "coverage-exclusions") });
  return <div className="space-y-2">
    <Button variant="outline" size="sm" onClick={() => download.mutate()} disabled={download.isPending}
      data-testid="button-download-exclusions">
      <Download className="mr-2 h-4 w-4" />{download.isPending ? "Preparing download…" : label}
    </Button>
    {download.isError && <p role="alert" className="text-sm text-destructive">
      {getApiErrorMessage(download.error, "Could not prepare the exclusion list.")}
    </p>}
  </div>;
}

/** What a generated file left out. Shown on Results and Deliver before sending. */
export function GeneratedExclusions({ wizardId, coverage }: {
  wizardId: string; coverage: EdiCoverageRunSummary | null | undefined;
}) {
  if (!coverage) return null;
  const reasons = Object.entries(coverage.byReason) as [EdiCoverageEntryReason, number][];
  return <aside aria-label="Coverage left out of this file" data-testid="generated-exclusions"
    className={`space-y-2 rounded-md border p-4 text-sm ${coverage.exclusionCount ? "border-destructive/50" : ""}`}>
    <p className="font-medium" role="status">
      {coverage.exclusionCount
        ? `${coverage.exclusionCount} coverage record group${coverage.exclusionCount === 1 ? " was" : "s were"} left out of this file.`
        : "No coverage was left out of this file."}
      {coverage.warningCount > 0 && ` ${coverage.warningCount} warning${coverage.warningCount === 1 ? "" : "s"} (not excluded).`}
    </p>
    {coverage.exclusionCount > 0 && <p>
      A member left out of a replacement membership file may have their coverage ended by the carrier.
      Review the list before sending.
    </p>}
    {!!reasons.length && <ul className="flex flex-wrap gap-2">
      {reasons.map(([reason, count]) => <li key={reason}><Badge variant="outline">{EDI_COVERAGE_REASONS[reason].label}: {count}</Badge></li>)}
    </ul>}
    <p className="text-muted-foreground">{RULE_TEXT[coverage.rule]}</p>
    {coverage.acknowledgement && <p className="break-words text-muted-foreground">
      Acknowledged by {coverage.acknowledgement.acknowledgedBy} · <time dateTime={coverage.acknowledgement.acknowledgedAt}>
        {formatWhen(coverage.acknowledgement.acknowledgedAt)}</time>
    </p>}
    {(coverage.exclusionCount > 0 || coverage.warningCount > 0) &&
      <ExclusionDownload wizardId={wizardId} stepId="deliver" />}
  </aside>;
}
