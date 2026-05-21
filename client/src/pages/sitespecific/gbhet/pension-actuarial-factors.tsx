import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Upload, Trash2, Loader2, FileSpreadsheet, AlertTriangle } from "lucide-react";

const FACTORS_API = "/api/sitespecific/gbhet/pension/factors";

const ELECTION_TYPES = [
  { value: "life", label: "Life Annuity" },
  { value: "5cc", label: "5-Year Certain & Continuous" },
  { value: "lump", label: "Lump Sum" },
  { value: "lumpearly", label: "Lump Sum (Early)" },
  { value: "50js", label: "50% Joint & Survivor" },
  { value: "75js", label: "75% Joint & Survivor" },
  { value: "100js", label: "100% Joint & Survivor" },
];

interface FactorsSummary {
  aiFactors: { count: number };
  payoutFactors: { count: number; byType: Record<string, number> };
  earlyRetirementFactors: { count: number };
  interestRates: { count: number };
}

interface AiFactor {
  id: string;
  age: number;
  factor: string;
}

interface PayoutFactor {
  id: string;
  electionType: string;
  subscriberAge: number;
  beneficiaryAge: number | null;
  factorYear: number;
  factor: string;
}

interface EarlyRetirementFactor {
  id: string;
  reason: string;
  monthlyFactor: string;
}

interface InterestRate {
  id: string;
  year: number;
  rate: string;
}

function parseCsv(text: string): string[][] {
  const lines = text.trim().split("\n");
  return lines.map(line =>
    line.split(/[,\t]/).map(cell => cell.trim())
  );
}

function AiFactorsSection() {
  const { toast } = useToast();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [clearExisting, setClearExisting] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: factors, isLoading } = useQuery<AiFactor[]>({
    queryKey: [`${FACTORS_API}/ai`],
  });

  const importMutation = useMutation({
    mutationFn: async (rows: { age: number; factor: string }[]) => {
      return await apiRequest("POST", `${FACTORS_API}/ai/import`, { rows, clearExisting });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/ai`] });
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/summary`] });
      const desc = data.errors ? `${data.imported}/${data.total} imported, ${data.errors.length} failed` : `${data.imported} AI factor(s) imported.`;
      toast({ title: "Import Complete", description: desc, variant: data.errors ? "destructive" : "default" });
      setImportDialogOpen(false);
      setCsvText("");
    },
    onError: (error) => {
      toast({ title: "Import Failed", description: error instanceof Error ? error.message : "An error occurred", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `${FACTORS_API}/ai/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/ai`] });
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/summary`] });
      toast({ title: "Deleted", description: "AI factor deleted." });
      setDeleteConfirmId(null);
    },
  });

  const handleImport = () => {
    const parsed = parseCsv(csvText);
    const headerRow = parsed[0];
    const hasHeader = headerRow && isNaN(Number(headerRow[0]));
    const dataRows = hasHeader ? parsed.slice(1) : parsed;

    const rows = dataRows
      .filter(r => r.length >= 2 && r[0] && r[1])
      .map(r => ({
        age: parseInt(r[0]),
        factor: r[1],
      }))
      .filter(r => !isNaN(r.age));

    if (rows.length === 0) {
      toast({ title: "No Data", description: "No valid rows found. Expected format: age, factor", variant: "destructive" });
      return;
    }
    importMutation.mutate(rows);
  };

  const previewRows = csvText ? (() => {
    const parsed = parseCsv(csvText);
    const headerRow = parsed[0];
    const hasHeader = headerRow && isNaN(Number(headerRow[0]));
    const dataRows = hasHeader ? parsed.slice(1) : parsed;
    return dataRows.filter(r => r.length >= 2 && r[0] && r[1]).slice(0, 5);
  })() : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-medium text-muted-foreground" data-testid="text-ai-factors-heading">
          Actuarial Increase Factors
        </h3>
        <Button onClick={() => setImportDialogOpen(true)} data-testid="button-import-ai-factors">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : factors && factors.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Age</TableHead>
              <TableHead className="text-right">Factor</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {factors.map((f) => (
              <TableRow key={f.id} data-testid={`row-ai-factor-${f.age}`}>
                <TableCell className="font-medium">{f.age}</TableCell>
                <TableCell className="text-right font-mono">{f.factor}</TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteConfirmId(f.id)} data-testid={`button-delete-ai-${f.age}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="text-no-ai-factors">No AI factors loaded. Import a CSV to get started.</p>
      )}

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Actuarial Increase Factors</DialogTitle>
            <DialogDescription>
              Paste CSV data with columns: age, factor. One row per age. Header row is optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"age,factor\n65,50000000\n66,47000000\n67,44000000"}
              className="min-h-[150px] font-mono text-sm"
              data-testid="textarea-ai-csv"
            />
            {previewRows.length > 0 && (
              <div className="text-sm">
                <p className="font-medium mb-1">Preview (first 5 rows):</p>
                <div className="bg-muted rounded-md p-2 font-mono text-xs space-y-0.5">
                  {previewRows.map((r, i) => (
                    <div key={i}>Age: {r[0]}, Factor: {r[1]}</div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="clear-ai"
                checked={clearExisting}
                onCheckedChange={(v) => setClearExisting(!!v)}
                data-testid="checkbox-clear-ai"
              />
              <Label htmlFor="clear-ai" className="text-sm">Clear existing factors before import</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importMutation.isPending || !csvText.trim()} data-testid="button-confirm-import-ai">
              {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>Are you sure you want to delete this factor?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)} data-testid="button-confirm-delete-ai">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const YEAR_BASED_TYPES = ["lump", "lumpearly"];

function PayoutFactorsSection() {
  const { toast } = useToast();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [bulkImportDialogOpen, setBulkImportDialogOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [clearExisting, setClearExisting] = useState(true);
  const [bulkClearExisting, setBulkClearExisting] = useState(true);
  const [selectedType, setSelectedType] = useState<string>("life");
  const [importType, setImportType] = useState<string>("life");
  const [selectedYear, setSelectedYear] = useState<string>(String(new Date().getFullYear()));
  const [importYear, setImportYear] = useState<string>(String(new Date().getFullYear()));

  const isYearBased = YEAR_BASED_TYPES.includes(selectedType);
  const isImportYearBased = YEAR_BASED_TYPES.includes(importType);

  const { data: factors, isLoading } = useQuery<PayoutFactor[]>({
    queryKey: [`${FACTORS_API}/payout`, selectedType, isYearBased ? selectedYear : null],
    queryFn: async () => {
      let url = `${FACTORS_API}/payout?electionType=${selectedType}`;
      if (isYearBased && selectedYear) {
        url += `&factorYear=${selectedYear}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const importMutation = useMutation({
    mutationFn: async (rows: { electionType: string; subscriberAge: number; beneficiaryAge?: number | null; factor: string }[]) => {
      const body: any = { rows, electionType: importType, clearExisting };
      if (isImportYearBased) {
        body.factorYear = parseInt(importYear);
      }
      return await apiRequest("POST", `${FACTORS_API}/payout/import`, body);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/payout`] });
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/summary`] });
      const desc = data.errors ? `${data.imported}/${data.total} imported, ${data.errors.length} failed` : `${data.imported} payout factor(s) imported.`;
      toast({ title: "Import Complete", description: desc, variant: data.errors ? "destructive" : "default" });
      setImportDialogOpen(false);
      setCsvText("");
    },
    onError: (error) => {
      toast({ title: "Import Failed", description: error instanceof Error ? error.message : "An error occurred", variant: "destructive" });
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (payload: { rows: any[]; lumpFactorYear?: number; clearExisting: boolean }) => {
      return await apiRequest("POST", `${FACTORS_API}/payout/bulk-import`, payload);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/payout`] });
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/summary`] });
      const desc = data.errors ? `${data.imported}/${data.total} imported, ${data.errors.length} failed` : `${data.imported} payout factor(s) imported across all types.`;
      toast({ title: "Bulk Import Complete", description: desc, variant: data.errors ? "destructive" : "default" });
      setBulkImportDialogOpen(false);
      setBulkCsvText("");
    },
    onError: (error) => {
      toast({ title: "Bulk Import Failed", description: error instanceof Error ? error.message : "An error occurred", variant: "destructive" });
    },
  });

  const isJointSurvivor = ["50js", "75js", "100js"].includes(importType);

  const handleImport = () => {
    if (isImportYearBased && (!importYear || isNaN(parseInt(importYear)))) {
      toast({ title: "Year Required", description: "Please enter a valid factor year for lump sum imports.", variant: "destructive" });
      return;
    }

    const parsed = parseCsv(csvText);
    const headerRow = parsed[0];
    const hasHeader = headerRow && isNaN(Number(headerRow[0]));
    const dataRows = hasHeader ? parsed.slice(1) : parsed;

    let rows;
    if (isJointSurvivor) {
      rows = dataRows
        .filter(r => r.length >= 3 && r[0] && r[1] && r[2])
        .map(r => ({
          electionType: importType,
          subscriberAge: parseInt(r[0]),
          beneficiaryAge: parseInt(r[1]),
          factor: r[2],
        }))
        .filter(r => !isNaN(r.subscriberAge) && !isNaN(r.beneficiaryAge));
    } else {
      rows = dataRows
        .filter(r => r.length >= 2 && r[0] && r[1])
        .map(r => ({
          electionType: importType,
          subscriberAge: parseInt(r[0]),
          beneficiaryAge: null,
          factor: r[1],
        }))
        .filter(r => !isNaN(r.subscriberAge));
    }

    if (rows.length === 0) {
      toast({ title: "No Data", description: `No valid rows found. Expected: ${isJointSurvivor ? "subscriber_age, beneficiary_age, factor" : "age, factor"}`, variant: "destructive" });
      return;
    }
    importMutation.mutate(rows);
  };

  type ColumnRole = "type" | "year" | "age" | "beneficiary_age" | "factor" | "skip";
  const COLUMN_ROLES: { value: ColumnRole; label: string }[] = [
    { value: "type", label: "Election Type" },
    { value: "year", label: "Factor Year" },
    { value: "age", label: "Subscriber Age" },
    { value: "beneficiary_age", label: "Beneficiary Age" },
    { value: "factor", label: "Factor Value" },
    { value: "skip", label: "(Skip)" },
  ];

  const [bulkWizardStep, setBulkWizardStep] = useState<"paste" | "map" | "preview">("paste");
  const [bulkParsedGrid, setBulkParsedGrid] = useState<string[][]>([]);
  const [bulkColumnMap, setBulkColumnMap] = useState<ColumnRole[]>([]);
  const [bulkHasHeader, setBulkHasHeader] = useState(false);

  function guessColumnRoles(grid: string[][]): { roles: ColumnRole[]; hasHeader: boolean } {
    if (grid.length === 0) return { roles: [], hasHeader: false };
    const colCount = grid[0].length;
    const firstRow = grid[0];
    const allTypes = ELECTION_TYPES.map(t => t.value);
    const headerLike = firstRow.some(c => isNaN(Number(c)) && !allTypes.includes(c.toLowerCase()));
    const sampleRow = headerLike && grid.length > 1 ? grid[1] : grid[0];

    const roles: ColumnRole[] = new Array(colCount).fill("skip");
    const used = new Set<ColumnRole>();

    if (headerLike) {
      for (let i = 0; i < colCount; i++) {
        const h = firstRow[i]?.toLowerCase() || "";
        if (h.includes("type") || h.includes("election")) { roles[i] = "type"; used.add("type"); }
        else if (h === "year" || h.includes("factor_year") || h.includes("factor year")) { roles[i] = "year"; used.add("year"); }
        else if (h.includes("beneficiary") || h === "ben_age" || h === "b_age") { roles[i] = "beneficiary_age"; used.add("beneficiary_age"); }
        else if (h.includes("subscriber") || h === "sub_age" || h === "age" || h === "member_age" || h === "s_age") { roles[i] = "age"; used.add("age"); }
        else if (h.includes("factor") || h === "value" || h === "rate") { roles[i] = "factor"; used.add("factor"); }
      }
    }

    const isAgeRange = (v: string) => { const n = parseInt(v); return !isNaN(n) && n >= 18 && n <= 120 && !v.includes("."); };
    const isYearRange = (v: string) => { const n = parseInt(v); return !isNaN(n) && n > 1900 && n < 2200; };

    for (let i = 0; i < colCount; i++) {
      if (roles[i] !== "skip") continue;
      const sv = sampleRow[i]?.trim() || "";
      if (!used.has("type") && isNaN(Number(sv))) { roles[i] = "type"; used.add("type"); continue; }
      if (!used.has("year") && isYearRange(sv) && !isAgeRange(sv)) { roles[i] = "year"; used.add("year"); continue; }
      if (!used.has("age") && isAgeRange(sv)) { roles[i] = "age"; used.add("age"); continue; }
      if (!used.has("beneficiary_age") && isAgeRange(sv)) { roles[i] = "beneficiary_age"; used.add("beneficiary_age"); continue; }
      if (!used.has("factor") && !isNaN(Number(sv))) { roles[i] = "factor"; used.add("factor"); continue; }
    }

    if (!used.has("factor")) {
      for (let i = colCount - 1; i >= 0; i--) {
        if (roles[i] !== "skip") continue;
        const sv = sampleRow[i]?.trim() || "";
        if (!isNaN(Number(sv))) { roles[i] = "factor"; used.add("factor"); break; }
      }
    }

    return { roles, hasHeader: headerLike };
  }

  function handleBulkPaste() {
    const grid = parseCsv(bulkCsvText);
    if (grid.length === 0) {
      toast({ title: "No Data", description: "Paste some CSV or tab-separated data first.", variant: "destructive" });
      return;
    }
    const { roles, hasHeader } = guessColumnRoles(grid);
    setBulkParsedGrid(grid);
    setBulkColumnMap(roles);
    setBulkHasHeader(hasHeader);
    setBulkWizardStep("map");
  }

  function buildMappedRows(): any[] {
    const dataRows = bulkHasHeader ? bulkParsedGrid.slice(1) : bulkParsedGrid;
    const typeIdx = bulkColumnMap.indexOf("type");
    const yearIdx = bulkColumnMap.indexOf("year");
    const ageIdx = bulkColumnMap.indexOf("age");
    const benAgeIdx = bulkColumnMap.indexOf("beneficiary_age");
    const factorIdx = bulkColumnMap.indexOf("factor");

    if (typeIdx === -1 || ageIdx === -1 || factorIdx === -1) return [];

    const rows: any[] = [];
    for (const r of dataRows) {
      const electionType = r[typeIdx]?.trim();
      if (!electionType) continue;
      const subscriberAge = parseInt(r[ageIdx]);
      if (isNaN(subscriberAge)) continue;
      const factor = r[factorIdx]?.trim();
      if (!factor) continue;

      const row: any = { electionType, subscriberAge, factor };
      if (yearIdx !== -1 && r[yearIdx]?.trim()) {
        const y = parseInt(r[yearIdx]);
        if (!isNaN(y)) row.factorYear = y;
      }
      if (benAgeIdx !== -1 && r[benAgeIdx]?.trim()) {
        const ba = parseInt(r[benAgeIdx]);
        if (!isNaN(ba)) row.beneficiaryAge = ba;
      }
      rows.push(row);
    }
    return rows;
  }

  const bulkMappedPreview = (() => {
    if (bulkWizardStep !== "map" && bulkWizardStep !== "preview") return { types: new Set<string>(), count: 0, rows: [] as any[] };
    const rows = buildMappedRows();
    const types = new Set<string>();
    for (const r of rows) types.add(r.electionType);
    return { types, count: rows.length, rows };
  })();

  function handleBulkImport() {
    const rows = buildMappedRows();
    if (rows.length === 0) {
      toast({ title: "No Data", description: "No valid rows could be mapped. Check your column assignments.", variant: "destructive" });
      return;
    }

    const lumpMissingYear = rows.some(r => {
      const t = r.electionType.toLowerCase();
      return (t === "lump" || t === "lumpearly") && !r.factorYear;
    });
    if (lumpMissingYear) {
      toast({ title: "Year Required", description: "Lump/lumpearly rows need a year column mapped.", variant: "destructive" });
      return;
    }

    bulkImportMutation.mutate({ rows, clearExisting: bulkClearExisting });
  }

  const electionLabel = ELECTION_TYPES.find(e => e.value === selectedType)?.label || selectedType;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-medium text-muted-foreground" data-testid="text-payout-factors-heading">
            Payout Factors
          </h3>
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger className="w-[220px]" data-testid="select-payout-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ELECTION_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isYearBased && (
            <Input
              type="number"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              placeholder="Year"
              className="w-[100px]"
              data-testid="input-payout-factor-year"
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBulkImportDialogOpen(true)} data-testid="button-bulk-import-payout-factors">
            <Upload className="mr-2 h-4 w-4" />
            Bulk Import All Types
          </Button>
          <Button onClick={() => { setImportType(selectedType); setImportYear(selectedYear); setImportDialogOpen(true); }} data-testid="button-import-payout-factors">
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : factors && factors.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subscriber Age</TableHead>
              {["50js", "75js", "100js"].includes(selectedType) && (
                <TableHead>Beneficiary Age</TableHead>
              )}
              {isYearBased && <TableHead>Year</TableHead>}
              <TableHead className="text-right">Factor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {factors.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.subscriberAge}</TableCell>
                {["50js", "75js", "100js"].includes(selectedType) && (
                  <TableCell>{f.beneficiaryAge ?? "-"}</TableCell>
                )}
                {isYearBased && <TableCell>{f.factorYear ?? "-"}</TableCell>}
                <TableCell className="text-right font-mono">{f.factor}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="text-no-payout-factors">
          No {electionLabel} factors loaded{isYearBased && selectedYear ? ` for ${selectedYear}` : ""}.
        </p>
      )}

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Payout Factors</DialogTitle>
            <DialogDescription>
              Importing for: <Badge variant="outline">{ELECTION_TYPES.find(e => e.value === importType)?.label}</Badge>
              {isImportYearBased && importYear && <> &mdash; Year: <Badge variant="outline">{importYear}</Badge></>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Election Type</Label>
              <Select value={importType} onValueChange={setImportType}>
                <SelectTrigger data-testid="select-import-payout-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ELECTION_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isImportYearBased && (
              <div>
                <Label className="text-sm">Factor Year</Label>
                <Input
                  type="number"
                  value={importYear}
                  onChange={(e) => setImportYear(e.target.value)}
                  placeholder="e.g. 2025"
                  data-testid="input-import-payout-year"
                />
              </div>
            )}
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={isJointSurvivor
                ? "subscriber_age,beneficiary_age,factor\n60,55,0.8500\n60,56,0.8600"
                : "age,factor\n60,1.0000\n61,1.0000"
              }
              className="min-h-[150px] font-mono text-sm"
              data-testid="textarea-payout-csv"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="clear-payout"
                checked={clearExisting}
                onCheckedChange={(v) => setClearExisting(!!v)}
                data-testid="checkbox-clear-payout"
              />
              <Label htmlFor="clear-payout" className="text-sm">
                Clear existing {ELECTION_TYPES.find(e => e.value === importType)?.label} factors{isImportYearBased && importYear ? ` for ${importYear}` : ""} before import
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importMutation.isPending || !csvText.trim()} data-testid="button-confirm-import-payout">
              {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkImportDialogOpen} onOpenChange={(open) => {
        setBulkImportDialogOpen(open);
        if (!open) { setBulkWizardStep("paste"); setBulkParsedGrid([]); setBulkColumnMap([]); }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Bulk Import Payout Factors
              {bulkWizardStep !== "paste" && (
                <span className="text-muted-foreground font-normal text-sm ml-2">
                  — Step {bulkWizardStep === "map" ? "2: Map Columns" : "3: Confirm"}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {bulkWizardStep === "paste" && "Paste your CSV or tab-separated data containing payout factors for any or all election types."}
              {bulkWizardStep === "map" && "Assign each column to a field. The guesses below are based on your data — adjust if needed."}
              {bulkWizardStep === "preview" && "Review the mapped data before importing."}
            </DialogDescription>
          </DialogHeader>

          {bulkWizardStep === "paste" && (
            <div className="space-y-3">
              <Textarea
                value={bulkCsvText}
                onChange={(e) => setBulkCsvText(e.target.value)}
                placeholder={"Paste data here...\ntype,year,age,factor\nlife,2025,60,12.345678\nlump,2025,60,9.876543"}
                className="min-h-[200px] font-mono text-sm"
                data-testid="textarea-bulk-payout-csv"
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkImportDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleBulkPaste} disabled={!bulkCsvText.trim()} data-testid="button-bulk-next-map">
                  Next: Map Columns
                </Button>
              </DialogFooter>
            </div>
          )}

          {bulkWizardStep === "map" && bulkParsedGrid.length > 0 && (
            <div className="space-y-4">
              <div className="border rounded-md overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {bulkColumnMap.map((role, colIdx) => (
                        <TableHead key={colIdx} className="p-1 min-w-[130px]">
                          <Select
                            value={role}
                            onValueChange={(val) => {
                              const next = [...bulkColumnMap];
                              next[colIdx] = val as ColumnRole;
                              setBulkColumnMap(next);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs" data-testid={`select-column-role-${colIdx}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {COLUMN_ROLES.map(cr => (
                                <SelectItem key={cr.value} value={cr.value}>{cr.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkParsedGrid.slice(0, 8).map((row, rowIdx) => (
                      <TableRow key={rowIdx} className={rowIdx === 0 && bulkHasHeader ? "bg-muted/50 italic" : ""}>
                        {row.map((cell, cellIdx) => (
                          <TableCell key={cellIdx} className="py-1 px-2 text-xs font-mono truncate max-w-[150px]">
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {bulkParsedGrid.length > 8 && (
                      <TableRow>
                        <TableCell colSpan={bulkColumnMap.length} className="text-center text-xs text-muted-foreground py-1">
                          ...and {bulkParsedGrid.length - 8} more rows
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-has-header"
                  checked={bulkHasHeader}
                  onCheckedChange={(v) => setBulkHasHeader(!!v)}
                  data-testid="checkbox-bulk-has-header"
                />
                <Label htmlFor="bulk-has-header" className="text-sm">First row is a header (skip it during import)</Label>
              </div>

              {bulkMappedPreview.count > 0 && (
                <div className="text-sm text-muted-foreground" data-testid="text-bulk-preview">
                  {bulkMappedPreview.count} rows mapped across types: {Array.from(bulkMappedPreview.types).map(t => (
                    <Badge key={t} variant="outline" className="mx-0.5">{t}</Badge>
                  ))}
                </div>
              )}
              {bulkMappedPreview.count === 0 && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  No valid rows with current mapping. Make sure Type, Age, and Factor columns are assigned.
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkWizardStep("paste")} data-testid="button-bulk-back-paste">Back</Button>
                <Button onClick={() => setBulkWizardStep("preview")} disabled={bulkMappedPreview.count === 0} data-testid="button-bulk-next-preview">
                  Next: Review &amp; Import
                </Button>
              </DialogFooter>
            </div>
          )}

          {bulkWizardStep === "preview" && (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><strong>{bulkMappedPreview.count}</strong> rows ready to import across <strong>{bulkMappedPreview.types.size}</strong> type(s):</p>
                <div className="flex flex-wrap gap-1">
                  {Array.from(bulkMappedPreview.types).map(t => {
                    const count = bulkMappedPreview.rows.filter(r => r.electionType === t).length;
                    return <Badge key={t} variant="outline">{t}: {count}</Badge>;
                  })}
                </div>
              </div>

              <div className="border rounded-md overflow-auto max-h-[200px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Type</TableHead>
                      {bulkColumnMap.includes("year") && <TableHead className="text-xs">Year</TableHead>}
                      <TableHead className="text-xs">Age</TableHead>
                      {bulkColumnMap.includes("beneficiary_age") && <TableHead className="text-xs">Ben. Age</TableHead>}
                      <TableHead className="text-xs text-right">Factor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkMappedPreview.rows.slice(0, 10).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-1 px-2 text-xs">{r.electionType}</TableCell>
                        {bulkColumnMap.includes("year") && <TableCell className="py-1 px-2 text-xs">{r.factorYear ?? "-"}</TableCell>}
                        <TableCell className="py-1 px-2 text-xs">{r.subscriberAge}</TableCell>
                        {bulkColumnMap.includes("beneficiary_age") && <TableCell className="py-1 px-2 text-xs">{r.beneficiaryAge ?? "-"}</TableCell>}
                        <TableCell className="py-1 px-2 text-xs text-right font-mono">{r.factor}</TableCell>
                      </TableRow>
                    ))}
                    {bulkMappedPreview.rows.length > 10 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-1">
                          ...and {bulkMappedPreview.rows.length - 10} more rows
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="clear-bulk-payout"
                  checked={bulkClearExisting}
                  onCheckedChange={(v) => setBulkClearExisting(!!v)}
                  data-testid="checkbox-clear-bulk-payout"
                />
                <Label htmlFor="clear-bulk-payout" className="text-sm">
                  Clear existing factors for each imported type before import
                </Label>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkWizardStep("map")} data-testid="button-bulk-back-map">Back</Button>
                <Button onClick={handleBulkImport} disabled={bulkImportMutation.isPending} data-testid="button-confirm-bulk-import-payout">
                  {bulkImportMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Import {bulkMappedPreview.count} Rows
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EarlyRetirementFactorsSection() {
  const { toast } = useToast();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [clearExisting, setClearExisting] = useState(true);

  const { data: factors, isLoading } = useQuery<EarlyRetirementFactor[]>({
    queryKey: [`${FACTORS_API}/early-retirement`],
  });

  const importMutation = useMutation({
    mutationFn: async (rows: { reason: string; monthlyFactor: string }[]) => {
      return await apiRequest("POST", `${FACTORS_API}/early-retirement/import`, { rows, clearExisting });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/early-retirement`] });
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/summary`] });
      const desc = data.errors ? `${data.imported}/${data.total} imported, ${data.errors.length} failed` : `${data.imported} early retirement factor(s) imported.`;
      toast({ title: "Import Complete", description: desc, variant: data.errors ? "destructive" : "default" });
      setImportDialogOpen(false);
      setCsvText("");
    },
    onError: (error) => {
      toast({ title: "Import Failed", description: error instanceof Error ? error.message : "An error occurred", variant: "destructive" });
    },
  });

  const handleImport = () => {
    const parsed = parseCsv(csvText);
    const headerRow = parsed[0];
    const hasHeader = headerRow && isNaN(Number(headerRow[0])) && headerRow[0].toLowerCase() !== "retirement";
    const dataRows = hasHeader ? parsed.slice(1) : parsed;

    const rows = dataRows
      .filter(r => r.length >= 2 && r[0] && r[1])
      .map(r => ({
        reason: r[0],
        monthlyFactor: r[1],
      }))
      .filter(r => r.reason.length > 0);

    if (rows.length === 0) {
      toast({ title: "No Data", description: "No valid rows found. Expected: reason, monthly_factor", variant: "destructive" });
      return;
    }
    importMutation.mutate(rows);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-medium text-muted-foreground" data-testid="text-early-ret-heading">
          Early Retirement Factors
        </h3>
        <Button onClick={() => setImportDialogOpen(true)} data-testid="button-import-early-ret">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : factors && factors.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Monthly Factor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {factors.map((f) => (
              <TableRow key={f.id} data-testid={`row-early-ret-${f.reason}`}>
                <TableCell className="font-medium">{f.reason}</TableCell>
                <TableCell className="text-right font-mono">{f.monthlyFactor}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="text-no-early-ret">No early retirement factors loaded.</p>
      )}

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Early Retirement Factors</DialogTitle>
            <DialogDescription>
              Paste CSV data with columns: reason, monthly_factor
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"reason,monthly_factor\nRetirement,0\nEarly Retirement,0.005\nDisability,0"}
              className="min-h-[120px] font-mono text-sm"
              data-testid="textarea-early-ret-csv"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="clear-early-ret"
                checked={clearExisting}
                onCheckedChange={(v) => setClearExisting(!!v)}
              />
              <Label htmlFor="clear-early-ret" className="text-sm">Clear existing factors before import</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importMutation.isPending || !csvText.trim()} data-testid="button-confirm-import-early-ret">
              {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InterestRatesSection() {
  const { toast } = useToast();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [clearExisting, setClearExisting] = useState(true);

  const { data: rates, isLoading } = useQuery<InterestRate[]>({
    queryKey: [`${FACTORS_API}/interest-rates`],
  });

  const importMutation = useMutation({
    mutationFn: async (rows: { year: number; rate: string }[]) => {
      return await apiRequest("POST", `${FACTORS_API}/interest-rates/import`, { rows, clearExisting });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/interest-rates`] });
      queryClient.invalidateQueries({ queryKey: [`${FACTORS_API}/summary`] });
      const desc = data.errors ? `${data.imported}/${data.total} imported, ${data.errors.length} failed` : `${data.imported} interest rate(s) imported.`;
      toast({ title: "Import Complete", description: desc, variant: data.errors ? "destructive" : "default" });
      setImportDialogOpen(false);
      setCsvText("");
    },
    onError: (error) => {
      toast({ title: "Import Failed", description: error instanceof Error ? error.message : "An error occurred", variant: "destructive" });
    },
  });

  const handleImport = () => {
    const parsed = parseCsv(csvText);
    const headerRow = parsed[0];
    const hasHeader = headerRow && isNaN(Number(headerRow[0]));
    const dataRows = hasHeader ? parsed.slice(1) : parsed;

    const rows = dataRows
      .filter(r => r.length >= 2 && r[0] && r[1])
      .map(r => ({
        year: parseInt(r[0]),
        rate: r[1],
      }))
      .filter(r => !isNaN(r.year));

    if (rows.length === 0) {
      toast({ title: "No Data", description: "No valid rows found. Expected: year, rate", variant: "destructive" });
      return;
    }
    importMutation.mutate(rows);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-medium text-muted-foreground" data-testid="text-interest-rates-heading">
          Interest Rates (for Lump Sum Elections)
        </h3>
        <Button onClick={() => setImportDialogOpen(true)} data-testid="button-import-interest-rates">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rates && rates.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.id} data-testid={`row-interest-rate-${r.year}`}>
                <TableCell className="font-medium">{r.year}</TableCell>
                <TableCell className="text-right font-mono">{r.rate}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="text-no-interest-rates">No interest rates loaded.</p>
      )}

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Interest Rates</DialogTitle>
            <DialogDescription>
              Paste CSV data with columns: year, rate
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"year,rate\n2020,0.035\n2021,0.028\n2022,0.045"}
              className="min-h-[120px] font-mono text-sm"
              data-testid="textarea-interest-rates-csv"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="clear-interest"
                checked={clearExisting}
                onCheckedChange={(v) => setClearExisting(!!v)}
              />
              <Label htmlFor="clear-interest" className="text-sm">Clear existing rates before import</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importMutation.isPending || !csvText.trim()} data-testid="button-confirm-import-interest">
              {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PensionActuarialFactorsPage() {
  usePageTitle("Pension Actuarial Factors");

  const { data: summary, isLoading: summaryLoading } = useQuery<FactorsSummary>({
    queryKey: [`${FACTORS_API}/summary`],
  });

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-factors-title">
            <FileSpreadsheet className="h-5 w-5" />
            VDB Actuarial Factor Tables
          </CardTitle>
          <CardDescription>
            Manage the actuarial factors used in VDB payout calculations. Import factors from CSV data (comma or tab separated).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : summary ? (
            <div className="flex flex-wrap gap-3" data-testid="factors-summary">
              <Badge variant="outline">AI Factors: {summary.aiFactors.count}</Badge>
              <Badge variant="outline">Payout Factors: {summary.payoutFactors.count}</Badge>
              <Badge variant="outline">Early Retirement: {summary.earlyRetirementFactors.count}</Badge>
              <Badge variant="outline">Interest Rates: {summary.interestRates.count}</Badge>
              {summary.payoutFactors.count > 0 && Object.entries(summary.payoutFactors.byType).map(([type, count]) => (
                <Badge key={type} variant="secondary">{type}: {count}</Badge>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              Unable to load factor summary.
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="ai" className="space-y-4">
        <TabsList data-testid="tabs-factors">
          <TabsTrigger value="ai" data-testid="tab-ai-factors">AI Factors</TabsTrigger>
          <TabsTrigger value="payout" data-testid="tab-payout-factors">Payout Factors</TabsTrigger>
          <TabsTrigger value="early-retirement" data-testid="tab-early-retirement">Early Retirement</TabsTrigger>
          <TabsTrigger value="interest" data-testid="tab-interest-rates">Interest Rates</TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
          <Card>
            <CardContent className="pt-6">
              <AiFactorsSection />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payout">
          <Card>
            <CardContent className="pt-6">
              <PayoutFactorsSection />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="early-retirement">
          <Card>
            <CardContent className="pt-6">
              <EarlyRetirementFactorsSection />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="interest">
          <Card>
            <CardContent className="pt-6">
              <InterestRatesSection />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
