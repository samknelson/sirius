import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, UsersRound, ShieldCheck, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  benefitOptions,
  employerOptions,
  illustrativeBenefitHistory,
  illustrativeBenefitsProvidedToDependents,
  type BenefitHistoryRecord,
} from "./_data";
import "./_group.css";

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const monthLabel = (month: number) => months[month - 1] ?? "";
const monthIndex = (year: number, month: number) => year * 12 + month;
const formatPeriod = (year: number, month: number) => `${monthLabel(month)} ${year}`;

type Era = {
  id: string;
  start: { year: number; month: number };
  end: { year: number; month: number };
  months: BenefitHistoryRecord[][];
  records: BenefitHistoryRecord[];
};

function identity(record: BenefitHistoryRecord) {
  return [
    record.benefit.id,
    record.employer.id,
    record.sourceRelationId ?? "own",
    record.sourceRelation?.sourceWorkerName ?? "",
  ].join("|");
}

function recordsSignature(records: BenefitHistoryRecord[]) {
  return records.map(identity).sort().join("::");
}

function buildEras(records: BenefitHistoryRecord[]) {
  const byMonth = new Map<number, BenefitHistoryRecord[]>();
  records.forEach((record) => {
    const key = monthIndex(record.year, record.month);
    byMonth.set(key, [...(byMonth.get(key) ?? []), record]);
  });
  const ordered = [...byMonth.entries()].sort((a, b) => a[0] - b[0]);
  const eras: Era[] = [];
  ordered.forEach(([key, monthRecords]) => {
    const previous = eras[eras.length - 1];
    const previousKey = previous ? monthIndex(previous.end.year, previous.end.month) : -100;
    const sameSet = previous && recordsSignature(previous.records) === recordsSignature(monthRecords);
    if (!previous || key !== previousKey + 1 || !sameSet) {
      eras.push({
        id: `${key}-${recordsSignature(monthRecords)}`,
        start: { year: monthRecords[0].year, month: monthRecords[0].month },
        end: { year: monthRecords[0].year, month: monthRecords[0].month },
        months: [monthRecords],
        records: monthRecords,
      });
    } else {
      previous.end = { year: monthRecords[0].year, month: monthRecords[0].month };
      previous.months.push(monthRecords);
    }
  });
  return eras.reverse();
}

function sourceLabel(record: BenefitHistoryRecord) {
  return record.sourceRelationId
    ? `Received via ${record.sourceRelation?.sourceWorkerName ?? "another worker"}`
    : "Own coverage";
}

function EraRow({
  era,
  onDelete,
}: {
  era: Era;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const range = era.start.year === era.end.year && era.start.month === era.end.month
    ? formatPeriod(era.start.year, era.start.month)
    : `${formatPeriod(era.start.year, era.start.month)} – ${formatPeriod(era.end.year, era.end.month)}`;
  const ownCount = era.records.filter((record) => !record.sourceRelationId).length;
  const receivedCount = era.records.length - ownCount;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-foreground">{range}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{era.months.length} {era.months.length === 1 ? "month" : "months"}</span>
            <span aria-hidden="true">·</span>
            <span>{ownCount} own{receivedCount ? ` · ${receivedCount} received` : ""}</span>
          </span>
        </span>
        <span className="hidden text-right text-xs text-muted-foreground sm:block">
          {era.records.length} {era.records.length === 1 ? "coverage" : "coverages"} in set
        </span>
      </button>
      <div className="px-5 pb-4 pl-[4.5rem]">
        <div className="flex flex-wrap gap-2">
          {era.records.map((record) => (
            <Badge key={identity(record)} variant="outline" className="gap-1.5 bg-background px-2.5 py-1 font-medium">
              <span className={`h-1.5 w-1.5 rounded-full ${record.sourceRelationId ? "bg-amber-500" : "bg-primary"}`} />
              {record.benefit.name}
              <span className="font-normal text-muted-foreground">· {record.employer.name}</span>
              <span className={`font-normal ${record.sourceRelationId ? "text-amber-700" : "text-muted-foreground"}`}>
                · {record.sourceRelationId ? `via ${record.sourceRelation?.sourceWorkerName ?? "another worker"}` : "Own"}
              </span>
            </Badge>
          ))}
        </div>
      </div>
      {open && (
        <div className="mx-5 mb-5 overflow-hidden rounded-lg border border-border bg-muted/20">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Monthly evidence</p>
              <p className="text-xs text-muted-foreground">Open a month to verify or correct its underlying record.</p>
            </div>
            <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider">Audit trail</Badge>
          </div>
          <div className="divide-y divide-border">
            {era.months.map((monthRecords) => (
              <div key={`${monthRecords[0].year}-${monthRecords[0].month}`} className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {formatPeriod(monthRecords[0].year, monthRecords[0].month)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">1 month · {monthRecords.length} entries</span>
                </div>
                <div className="space-y-2">
                  {monthRecords.map((record) => (
                    <div key={record.id} className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium">{record.benefit.name}</span>
                        <span className="ml-2 text-muted-foreground">{sourceLabel(record)}</span>
                        <span className="block text-xs text-muted-foreground">{record.employer.name}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(record.id)}
                        aria-label={`Delete ${record.benefit.name} entry for ${formatPeriod(record.year, record.month)}`}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 size={15} />
                        <span className="sr-only">Delete record</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function GroupedEras() {
  const [benefits, setBenefits] = useState<BenefitHistoryRecord[]>(illustrativeBenefitHistory);
  const [filter, setFilter] = useState("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [benefitId, setBenefitId] = useState("");
  const [employerId, setEmployerId] = useState("");

  const filteredBenefits = useMemo(
    () => filter === "all" ? benefits : benefits.filter((record) => record.benefit.id === filter),
    [benefits, filter],
  );
  const eras = useMemo(() => buildEras(filteredBenefits), [filteredBenefits]);
  const years = Array.from({ length: 6 }, (_, index) => new Date().getFullYear() - index);
  const selectedBenefit = benefitOptions.find((item) => item.id === benefitId);
  const selectedEmployer = employerOptions.find((item) => item.id === employerId);

  const handleCreate = () => {
    if (!year || !month || !selectedBenefit || !selectedEmployer) return;
    setBenefits((current) => [...current, {
      id: `local-${Date.now()}`,
      year: Number(year),
      month: Number(month),
      benefit: selectedBenefit,
      employer: selectedEmployer,
      sourceRelationId: null,
      sourceRelation: null,
    }].sort((a, b) => monthIndex(b.year, b.month) - monthIndex(a.year, a.month)));
    setIsAddOpen(false);
    setYear(""); setMonth(""); setBenefitId(""); setEmployerId("");
  };

  const deleteRecord = (id: string) => {
    setBenefits((current) => current.filter((record) => record.id !== id));
  };

  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border bg-card pb-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  <ShieldCheck size={15} className="text-primary" /> Worker record · illustrative history
                </div>
                <CardTitle className="text-2xl tracking-tight">Benefit History</CardTitle>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Coverage eras summarize each uninterrupted set of benefits. Expand an era to inspect every monthly record.
                </p>
              </div>
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="shrink-0"><Plus size={16} className="mr-2" /> Add Benefit Entry</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Benefit Entry</DialogTitle>
                    <DialogDescription>Record one monthly coverage entry for this worker.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-2"><Label htmlFor="grouped-year">Year</Label><Select value={year} onValueChange={setYear}><SelectTrigger id="grouped-year"><SelectValue placeholder="Select year" /></SelectTrigger><SelectContent>{years.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select></div>
                    <div className="grid gap-2"><Label htmlFor="grouped-month">Month</Label><Select value={month} onValueChange={setMonth}><SelectTrigger id="grouped-month"><SelectValue placeholder="Select month" /></SelectTrigger><SelectContent>{months.map((item, index) => <SelectItem key={item} value={String(index + 1)}>{item}</SelectItem>)}</SelectContent></Select></div>
                    <div className="grid gap-2"><Label htmlFor="grouped-benefit">Benefit</Label><Select value={benefitId} onValueChange={setBenefitId}><SelectTrigger id="grouped-benefit"><SelectValue placeholder="Select benefit" /></SelectTrigger><SelectContent>{benefitOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
                    <div className="grid gap-2"><Label htmlFor="grouped-employer">Employer</Label><Select value={employerId} onValueChange={setEmployerId}><SelectTrigger id="grouped-employer"><SelectValue placeholder="Select employer" /></SelectTrigger><SelectContent>{employerOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <DialogFooter><Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button><Button type="button" disabled={!year || !month || !benefitId || !employerId} onClick={handleCreate}>Create Entry</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-b border-border bg-amber-50/60 px-5 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-700">
                    <UsersRound size={14} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">Provided to dependent · illustrative</p>
                    <p className="text-xs text-muted-foreground">
                      Casey Lee · Medical + Dental · January 2025
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-medium text-amber-800">Not part of own coverage</span>
              </div>
              <p className="mt-2 pl-10 text-[11px] leading-relaxed text-muted-foreground">
                Separate relationship data shown for illustration. The history API includes own and received coverage, not benefits this worker provides to dependents.
              </p>
            </div>
            <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <label htmlFor="benefit-filter" className="text-sm font-medium">Show benefit</label>
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger id="benefit-filter" className="h-9 w-[180px] bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All benefits</SelectItem>{benefitOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <span className="text-xs text-muted-foreground">{eras.length} {eras.length === 1 ? "coverage era" : "coverage eras"} · {filteredBenefits.length} monthly entries</span>
            </div>
            <div className="flex items-start gap-3 border-b border-border px-5 py-3 text-xs text-muted-foreground">
              <Info size={15} className="mt-0.5 shrink-0 text-primary" />
              <p>Era boundaries reflect a gap, employer change, benefit change, or a change between own and received coverage. Records are never merged across those changes.</p>
            </div>
            {eras.length === 0 ? <div className="px-5 py-14 text-center text-sm text-muted-foreground">No monthly records match this filter.</div> : eras.map((era) => <EraRow key={era.id} era={era} onDelete={deleteRecord} />)}
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700"><UsersRound size={18} /></span>
              <div><CardTitle className="text-base">Related benefits provided to dependents</CardTitle><p className="mt-1 text-sm text-muted-foreground">Separate relationship lane · illustrative fixture only</p></div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-lg border border-border bg-muted/15">
              {illustrativeBenefitsProvidedToDependents.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-sm font-medium">{item.benefitName} for {item.dependentName} <span className="font-normal text-muted-foreground">({item.relationship})</span></p><p className="text-xs text-muted-foreground">{formatPeriod(item.year, item.month)} · provided by {item.providedByWorkerName}</p></div>
                  <Badge variant="outline" className="w-fit bg-background text-xs">{item.employerName}</Badge>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">This area is not part of Alex Morgan&apos;s own coverage history. The history API reports received coverage only, not benefits provided to dependents.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}