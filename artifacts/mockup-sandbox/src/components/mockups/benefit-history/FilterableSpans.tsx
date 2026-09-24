import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Filter, Plus, ShieldCheck, Trash2, UsersRound } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

type Span = {
  key: string;
  benefit: BenefitHistoryRecord["benefit"];
  employer: BenefitHistoryRecord["employer"];
  sourceRelationId: string | null;
  sourceRelation: BenefitHistoryRecord["sourceRelation"];
  records: BenefitHistoryRecord[];
};

function monthIndex(record: BenefitHistoryRecord) {
  return record.year * 12 + record.month;
}

function makeSpans(records: BenefitHistoryRecord[]) {
  const sorted = [...records].sort((a, b) => monthIndex(a) - monthIndex(b));
  const buckets = new Map<string, BenefitHistoryRecord[]>();
  sorted.forEach((record) => {
    const key = [
      record.benefit.id,
      record.employer.id,
      record.sourceRelationId ?? "own",
    ].join("|");
    buckets.set(key, [...(buckets.get(key) ?? []), record]);
  });

  const spans: Span[] = [];
  buckets.forEach((bucket, key) => {
    let current: BenefitHistoryRecord[] = [];
    bucket.forEach((record, index) => {
      const previous = bucket[index - 1];
      if (previous && monthIndex(record) !== monthIndex(previous) + 1) {
        spans.push(toSpan(key, current));
        current = [];
      }
      current.push(record);
    });
    if (current.length) spans.push(toSpan(key, current));
  });
  return spans.sort((a, b) => monthIndex(b.records[b.records.length - 1]) - monthIndex(a.records[a.records.length - 1]));
}

function toSpan(key: string, records: BenefitHistoryRecord[]): Span {
  const first = records[0];
  return {
    key: `${key}-${first.id}`,
    benefit: first.benefit,
    employer: first.employer,
    sourceRelationId: first.sourceRelationId,
    sourceRelation: first.sourceRelation,
    records,
  };
}

function rangeLabel(records: BenefitHistoryRecord[]) {
  const start = records[0];
  const end = records[records.length - 1];
  if (start.year === end.year && start.month === end.month) return `${months[start.month - 1]} ${start.year}`;
  if (start.year === end.year) return `${months[start.month - 1]}–${months[end.month - 1]} ${start.year}`;
  return `${months[start.month - 1]} ${start.year}–${months[end.month - 1]} ${end.year}`;
}

export function FilterableSpans() {
  const [records, setRecords] = useState(illustrativeBenefitHistory);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [benefitId, setBenefitId] = useState("");
  const [employerId, setEmployerId] = useState("");

  const spans = useMemo(
    () => makeSpans(records.filter((record) => filter === "all" || record.benefit.id === filter)),
    [records, filter],
  );
  const coveredMonths = new Set(records.map((record) => `${record.year}-${record.month}`)).size;
  const years = Array.from({ length: 6 }, (_, index) => new Date().getFullYear() - index);

  const toggleExpanded = (key: string) => {
    setExpanded((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const deleteRecord = (id: string, label: string) => {
    if (window.confirm(`Remove the ${label} record? This is an illustrative correction only.`)) {
      setRecords((current) => current.filter((record) => record.id !== id));
    }
  };

  const handleAdd = () => {
    const benefit = benefitOptions.find((item) => item.id === benefitId);
    const employer = employerOptions.find((item) => item.id === employerId);
    if (!benefit || !employer || !year || !month) return;
    setRecords((current) => [...current, {
      id: `local-${Date.now()}`,
      year: Number(year),
      month: Number(month),
      benefit,
      employer,
      sourceRelationId: null,
      sourceRelation: null,
    }].sort((a, b) => monthIndex(b) - monthIndex(a)));
    setIsAddOpen(false);
    setYear(""); setMonth(""); setBenefitId(""); setEmployerId("");
  };

  return (
    <div className="min-h-screen bg-background p-5 text-foreground sm:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <Card className="border-dashed border-slate-300 bg-slate-50/70">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-slate-200 p-2 text-slate-600"><UsersRound className="h-4 w-4" /></div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">Provided to dependents</p>
                  <Badge variant="outline" className="border-slate-300 bg-white text-[10px] font-medium uppercase tracking-wide text-slate-600">Illustrative only</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Separate from this worker’s own or received coverage. This related-benefits example is not returned by the existing history API.
                </p>
              </div>
            </div>
            <div className="rounded-md border bg-white px-3 py-2 text-sm shadow-sm">
              <div className="font-medium">Casey Lee <span className="font-normal text-muted-foreground">· Child</span></div>
              <div className="mt-0.5 text-xs text-muted-foreground">Medical + Dental · January 2025</div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-card pb-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Worker benefits · history</p>
                <CardTitle className="text-2xl tracking-tight">Benefit History</CardTitle>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Review uninterrupted coverage runs. Expand a run to see and correct each underlying month.
                </p>
              </div>
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="shrink-0"><Plus className="mr-2 h-4 w-4" />Add Benefit Entry</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Benefit Entry</DialogTitle><DialogDescription>Record one monthly history entry for this worker.</DialogDescription></DialogHeader>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><Label htmlFor="span-year">Year</Label><Select value={year} onValueChange={setYear}><SelectTrigger id="span-year"><SelectValue placeholder="Select year" /></SelectTrigger><SelectContent>{years.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label htmlFor="span-month">Month</Label><Select value={month} onValueChange={setMonth}><SelectTrigger id="span-month"><SelectValue placeholder="Select month" /></SelectTrigger><SelectContent>{months.map((item, index) => <SelectItem key={item} value={String(index + 1)}>{item}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label htmlFor="span-benefit">Benefit</Label><Select value={benefitId} onValueChange={setBenefitId}><SelectTrigger id="span-benefit"><SelectValue placeholder="Select benefit" /></SelectTrigger><SelectContent>{benefitOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label htmlFor="span-employer">Employer</Label><Select value={employerId} onValueChange={setEmployerId}><SelectTrigger id="span-employer"><SelectValue placeholder="Select employer" /></SelectTrigger><SelectContent>{employerOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <DialogFooter><Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button><Button onClick={handleAdd} disabled={!year || !month || !benefitId || !employerId}>Create Entry</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Filter className="h-4 w-4 text-muted-foreground" /><Label htmlFor="benefit-filter">Show</Label></div>
              <Select value={filter} onValueChange={setFilter}><SelectTrigger id="benefit-filter" className="w-[190px] bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All benefit types</SelectItem>{benefitOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
              <span className="text-xs text-muted-foreground">{spans.length} spans · {coveredMonths} covered months</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Each range breaks at a gap, employer change, benefit change, or own-vs-via source change.</span>
            </div>
            <div className="divide-y">
              {spans.map((span) => {
                const isOpen = expanded.includes(span.key);
                const source = span.sourceRelationId ? `Received via ${span.sourceRelation?.sourceWorkerName ?? "another worker"}` : "Own coverage";
                return (
                  <section key={span.key} aria-labelledby={`${span.key}-heading`}>
                    <button type="button" className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" onClick={() => toggleExpanded(span.key)} aria-expanded={isOpen} aria-controls={`${span.key}-months`}>
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0 flex-1"><div id={`${span.key}-heading`} className="flex flex-wrap items-center gap-2"><span className="font-semibold">{span.benefit.name}</span><Badge variant="outline" className="font-normal">{rangeLabel(span.records)}</Badge></div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{source}{span.sourceRelation?.relationTypeName ? ` · ${span.sourceRelation.relationTypeName}` : ""}</span><span>{span.employer.name}</span></div></div>
                      <span className="hidden text-xs text-muted-foreground sm:inline">{span.records.length} {span.records.length === 1 ? "month" : "months"}</span>
                    </button>
                    {isOpen && <div id={`${span.key}-months`} className="border-t bg-muted/15 px-5 pb-4 pt-2"><Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Source</TableHead><TableHead>Employer</TableHead><TableHead className="w-20 text-right">Action</TableHead></TableRow></TableHeader><TableBody>{span.records.map((record) => <TableRow key={record.id}><TableCell className="font-medium">{months[record.month - 1]} {record.year}</TableCell><TableCell className="text-muted-foreground">{record.sourceRelationId ? `Via ${record.sourceRelation?.sourceWorkerName ?? "another worker"}` : "Own"}</TableCell><TableCell className="text-muted-foreground">{record.employer.name}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={(event) => { event.stopPropagation(); deleteRecord(record.id, `${record.benefit.name} · ${months[record.month - 1]} ${record.year}`); }} aria-label={`Delete ${record.benefit.name} entry for ${months[record.month - 1]} ${record.year}`}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
                  </section>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader className="pb-3"><div className="flex items-start gap-3"><div className="rounded-md bg-muted p-2 text-muted-foreground"><UsersRound className="h-4 w-4" /></div><div><CardTitle className="text-base">Related benefits provided to dependents</CardTitle><p className="mt-1 text-xs text-muted-foreground">Illustrative only · separate from Alex Morgan’s own coverage</p></div></div></CardHeader>
          <CardContent className="pt-0"><div className="rounded-md border bg-muted/20"><div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>Dependent and benefit</span><span>Coverage month</span></div>{illustrativeBenefitsProvidedToDependents.map((item) => <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t px-4 py-3 text-sm"><div><div className="font-medium">{item.dependentName} <span className="font-normal text-muted-foreground">({item.relationship})</span></div><div className="text-xs text-muted-foreground">{item.benefitName} · {item.employerName} · provided by {item.providedByWorkerName}</div></div><Badge variant="secondary">{months[item.month - 1]} {item.year}</Badge></div>)}</div></CardContent>
        </Card>
      </div>
    </div>
  );
}