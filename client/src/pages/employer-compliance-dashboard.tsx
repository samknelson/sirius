import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Building2, Loader2, Send, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { WizardType } from "@/lib/wizard-types";
import type { LedgerAccount } from "@/lib/ledger-types";

type StatusFilter =
  | "all"
  | "missing_current"
  | "incomplete"
  | "completed"
  | "any_overdue";

type BalanceFilter = "all" | "positive" | "negative" | "nonzero";

interface ContactTypeOption {
  id: string;
  name: string;
  displayName?: string | null;
}

interface CompanyOption {
  id: string;
  name: string;
}

interface MonthCell {
  year: number;
  month: number;
  wizardId: string | null;
  status: string | null;
  currentStep: string | null;
}

interface ComplianceRow {
  employerId: string;
  employerName: string;
  siriusId: number;
  isActive: boolean;
  companyId: string | null;
  companyName: string | null;
  months: MonthCell[];
  balances: Record<string, string | null>;
  totalBalance: string;
}

interface DashboardResponse {
  monthPeriods: Array<{ year: number; month: number }>;
  rows: ComplianceRow[];
}

const MEDIA_OPTIONS: Array<{ value: "sms" | "email" | "inapp" | "postal"; label: string }> = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "inapp", label: "In-app" },
  { value: "postal", label: "Postal" },
];

function statusToVariant(status: string | null): string {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-100";
    case "in_progress":
      return "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-100";
    case "draft":
      return "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900 dark:text-blue-100";
    case "error":
      return "bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-100";
    case "cancelled":
      return "bg-gray-200 text-gray-700 border-gray-400 dark:bg-gray-700 dark:text-gray-100";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function readQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

export default function EmployerComplianceDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { hasComponent } = useAuth();
  const ledgerEnabled = hasComponent("ledger");
  const companyEnabled = hasComponent("employer.company");

  const today = new Date();
  const defaultYear = today.getFullYear();
  const defaultMonth = today.getMonth() + 1;

  const [year, setYear] = useState<number>(() => {
    const v = readQueryParam("year");
    return v ? Number(v) : defaultYear;
  });
  const [month, setMonth] = useState<number>(() => {
    const v = readQueryParam("month");
    return v ? Number(v) : defaultMonth;
  });
  const [wizardType, setWizardType] = useState<string>(
    () => readQueryParam("wizardType") ?? "",
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(() => {
    const v = readQueryParam("accounts");
    return v ? v.split(",").filter(Boolean) : [];
  });
  const [companyFilter, setCompanyFilter] = useState<string>(
    () => readQueryParam("company") ?? "all",
  );
  const [nameSearch, setNameSearch] = useState<string>(
    () => readQueryParam("q") ?? "",
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    () => (readQueryParam("status") as StatusFilter) || "all",
  );
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>(
    () => (readQueryParam("balance") as BalanceFilter) || "all",
  );

  const [selectedEmployerIds, setSelectedEmployerIds] = useState<Set<string>>(new Set());
  const [selectedContactTypeIds, setSelectedContactTypeIds] = useState<string[]>([]);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkName, setBulkName] = useState("");
  const [bulkMedia, setBulkMedia] = useState<Array<"sms" | "email" | "inapp" | "postal">>(["email"]);

  const { data: wizardTypes = [] } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });
  const monthlyWizardTypes = useMemo(
    () => wizardTypes.filter((wt) => wt.isMonthly === true),
    [wizardTypes],
  );

  useEffect(() => {
    if (!wizardType && monthlyWizardTypes.length > 0) {
      setWizardType(monthlyWizardTypes[0].name);
    }
  }, [monthlyWizardTypes, wizardType]);

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
    enabled: ledgerEnabled,
  });

  const { data: contactTypes = [] } = useQuery<ContactTypeOption[]>({
    queryKey: ["/api/options/employer-contact-type"],
  });

  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["/api/companies"],
    enabled: companyEnabled,
  });

  const dashboardEnabled = Boolean(wizardType);
  const { data, isLoading, error, refetch } = useQuery<DashboardResponse>({
    queryKey: [
      "/api/employer-compliance/dashboard",
      { year, month, wizardType, monthsBack: 6, ledgerAccountIds: selectedAccountIds.join(",") },
    ],
    enabled: dashboardEnabled,
  });

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("year", String(year));
    params.set("month", String(month));
    if (wizardType) params.set("wizardType", wizardType);
    if (selectedAccountIds.length > 0) params.set("accounts", selectedAccountIds.join(","));
    if (companyFilter !== "all") params.set("company", companyFilter);
    if (nameSearch) params.set("q", nameSearch);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (balanceFilter !== "all") params.set("balance", balanceFilter);
    const qs = params.toString();
    const newUrl = `/employers/compliance${qs ? `?${qs}` : ""}`;
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, "", newUrl);
    }
  }, [
    year,
    month,
    wizardType,
    selectedAccountIds,
    companyFilter,
    nameSearch,
    statusFilter,
    balanceFilter,
  ]);

  const monthPeriods = data?.monthPeriods ?? [];
  const monthLabels = monthPeriods.map((p) =>
    format(new Date(p.year, p.month - 1, 1), "MMM yyyy"),
  );

  const rows = data?.rows ?? [];

  const filteredRows = useMemo(() => {
    const search = nameSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (search) {
        const inName = row.employerName.toLowerCase().includes(search);
        const inSid = String(row.siriusId).includes(search);
        if (!inName && !inSid) return false;
      }
      if (companyFilter !== "all") {
        if (companyFilter === "__none__") {
          if (row.companyId) return false;
        } else if (row.companyId !== companyFilter) {
          return false;
        }
      }
      if (statusFilter !== "all") {
        const last = row.months[row.months.length - 1];
        if (statusFilter === "missing_current") {
          if (last && last.status) return false;
        } else if (statusFilter === "completed") {
          if (!last || last.status !== "completed") return false;
        } else if (statusFilter === "incomplete") {
          if (!last || last.status === "completed") return false;
        } else if (statusFilter === "any_overdue") {
          const hasOverdue = row.months
            .slice(0, -1)
            .some((m) => !m.status || (m.status !== "completed" && m.status !== "cancelled"));
          if (!hasOverdue) return false;
        }
      }
      if (balanceFilter !== "all" && selectedAccountIds.length > 0) {
        const total = Number(row.totalBalance);
        if (balanceFilter === "positive" && !(total > 0)) return false;
        if (balanceFilter === "negative" && !(total < 0)) return false;
        if (balanceFilter === "nonzero" && total === 0) return false;
      }
      return true;
    });
  }, [rows, nameSearch, companyFilter, statusFilter, balanceFilter, selectedAccountIds.length]);

  const allVisibleSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedEmployerIds.has(r.employerId));

  const toggleAllVisible = (checked: boolean) => {
    setSelectedEmployerIds((prev) => {
      const next = new Set(prev);
      if (checked) filteredRows.forEach((r) => next.add(r.employerId));
      else filteredRows.forEach((r) => next.delete(r.employerId));
      return next;
    });
  };

  const toggleEmployer = (id: string, checked: boolean) => {
    setSelectedEmployerIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAccount = (id: string, checked: boolean) => {
    setSelectedAccountIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  };

  const toggleContactType = (id: string, checked: boolean) => {
    setSelectedContactTypeIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  };

  const toggleMedium = (m: "sms" | "email" | "inapp" | "postal", checked: boolean) => {
    setBulkMedia((prev) => {
      if (checked) return prev.includes(m) ? prev : [...prev, m];
      return prev.filter((x) => x !== m);
    });
  };

  const queueBulkMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/employer-compliance/queue-bulk", {
        name: bulkName,
        medium: bulkMedia,
        employerIds: Array.from(selectedEmployerIds),
        contactTypeIds: selectedContactTypeIds,
      });
    },
    onSuccess: (resp: any) => {
      const missing = Array.isArray(resp.employersWithoutContacts)
        ? resp.employersWithoutContacts.length
        : 0;
      toast({
        title: "Bulk message draft created",
        description:
          `Resolved ${resp.contactCount} contact${
            resp.contactCount === 1 ? "" : "s"
          } across ${resp.employerCount} employer${
            resp.employerCount === 1 ? "" : "s"
          }.` +
          (missing > 0
            ? ` ${missing} employer${missing === 1 ? " has" : "s have"} no matching contacts.`
            : ""),
        variant: missing > 0 ? "destructive" : undefined,
      });
      setBulkOpen(false);
      setBulkName("");
      setSelectedEmployerIds(new Set());
      if (resp.bulkMessageId) {
        setLocation(`/bulk/${resp.bulkMessageId}`);
      }
    },
    onError: (err: any) => {
      toast({
        title: "Failed to queue bulk message",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const yearOptions = (() => {
    const cur = new Date().getFullYear();
    return [cur, cur - 1, cur - 2, cur - 3];
  })();
  const monthOptions = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const accountById = new Map(ledgerAccounts.map((a) => [a.id, a] as const));
  const selectedAccountCount = selectedAccountIds.length;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2" data-testid="text-page-title">
          Employer Compliance
        </h1>
        <p className="text-muted-foreground">
          Six-month upload status and current balances for every active employer.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Choose period, upload type, and balance accounts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label className="mb-1 block">Year</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger data-testid="select-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">Anchor Month</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger data-testid="select-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m, idx) => (
                    <SelectItem key={m} value={String(idx + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">Upload Type</Label>
              <Select
                value={wizardType}
                onValueChange={setWizardType}
                disabled={monthlyWizardTypes.length === 0}
              >
                <SelectTrigger data-testid="select-wizard-type">
                  <SelectValue placeholder="Select wizard type" />
                </SelectTrigger>
                <SelectContent>
                  {monthlyWizardTypes.map((wt) => (
                    <SelectItem key={wt.name} value={wt.name}>{wt.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {ledgerEnabled && (
              <div>
                <Label className="mb-1 block">Ledger Accounts</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      data-testid="button-accounts-picker"
                    >
                      {selectedAccountCount === 0
                        ? "Select accounts"
                        : `${selectedAccountCount} selected`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2 max-h-72 overflow-y-auto">
                    {ledgerAccounts.length === 0 ? (
                      <div className="text-sm text-muted-foreground p-2">No accounts</div>
                    ) : (
                      ledgerAccounts.map((a) => (
                        <label
                          key={a.id}
                          className="flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedAccountIds.includes(a.id)}
                            onCheckedChange={(c) => toggleAccount(a.id, Boolean(c))}
                            data-testid={`checkbox-account-${a.id}`}
                          />
                          <span className="text-sm">{a.name}</span>
                        </label>
                      ))
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label className="mb-1 block">Search</Label>
              <Input
                placeholder="Name or Sirius ID"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                data-testid="input-search"
              />
            </div>
            {companyEnabled && (
              <div>
                <Label className="mb-1 block">Company</Label>
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger data-testid="select-company">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All companies</SelectItem>
                    <SelectItem value="__none__">No company</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="mb-1 block">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="missing_current">Missing current month</SelectItem>
                  <SelectItem value="incomplete">Current month not completed</SelectItem>
                  <SelectItem value="completed">Current month completed</SelectItem>
                  <SelectItem value="any_overdue">Any prior month overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">Balance</Label>
              <Select
                value={balanceFilter}
                onValueChange={(v) => setBalanceFilter(v as BalanceFilter)}
                disabled={selectedAccountIds.length === 0}
              >
                <SelectTrigger data-testid="select-balance-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="positive">Outstanding (&gt; 0)</SelectItem>
                  <SelectItem value="negative">Credit (&lt; 0)</SelectItem>
                  <SelectItem value="nonzero">Non-zero</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <span className="text-xs text-muted-foreground">Legend:</span>
            {["completed", "in_progress", "draft", "error", "cancelled"].map((s) => (
              <span key={s} className={`text-xs px-2 py-0.5 rounded border ${statusToVariant(s)}`}>
                {s.replace("_", " ")}
              </span>
            ))}
            <span className="text-xs px-2 py-0.5 rounded border bg-muted text-muted-foreground">
              no upload
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              Compliance Grid
            </CardTitle>
            <CardDescription>
              {monthLabels.length > 0
                ? `Showing ${monthLabels[0]} – ${monthLabels[monthLabels.length - 1]}`
                : "Select an upload type to view data"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground" data-testid="text-selected-count">
              {selectedEmployerIds.size} selected
            </span>
            <Button
              onClick={() => {
                if (selectedEmployerIds.size === 0) {
                  toast({
                    title: "Select at least one employer",
                    variant: "destructive",
                  });
                  return;
                }
                if (!bulkName) {
                  setBulkName(
                    `Compliance follow-up ${format(new Date(), "yyyy-MM-dd")}`,
                  );
                }
                setBulkOpen(true);
              }}
              data-testid="button-queue-bulk"
            >
              <Send className="h-4 w-4 mr-2" />
              Queue Bulk Message
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-8 text-destructive flex flex-col items-center gap-2">
              <AlertCircle className="h-6 w-6" />
              <p className="font-medium">Failed to load dashboard</p>
              <p className="text-sm">{(error as Error).message}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : isLoading ? (
            <div className="text-center py-8 text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>No employers match the current filters.</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(c) => toggleAllVisible(Boolean(c))}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead className="w-[260px]">Employer</TableHead>
                    {monthPeriods.map((p, idx) => (
                      <TableHead
                        key={`${p.year}-${p.month}`}
                        className="text-center"
                        data-testid={`table-header-month-${idx}`}
                      >
                        {monthLabels[idx]}
                      </TableHead>
                    ))}
                    {selectedAccountIds.map((accId) => (
                      <TableHead key={accId} className="text-right">
                        {accountById.get(accId)?.name ?? "Account"}
                      </TableHead>
                    ))}
                    {selectedAccountIds.length > 1 && (
                      <TableHead className="text-right font-semibold">Total</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => (
                    <TableRow key={row.employerId} data-testid={`row-${row.employerId}`}>
                      <TableCell>
                        <Checkbox
                          checked={selectedEmployerIds.has(row.employerId)}
                          onCheckedChange={(c) => toggleEmployer(row.employerId, Boolean(c))}
                          data-testid={`checkbox-employer-${row.employerId}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div
                          className="font-medium cursor-pointer hover:underline"
                          onClick={() => setLocation(`/employers/${row.employerId}`)}
                          data-testid={`link-employer-${row.employerId}`}
                        >
                          {row.employerName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ID: {row.siriusId}
                          {row.companyName && (
                            <span className="ml-2">· {row.companyName}</span>
                          )}
                        </div>
                      </TableCell>
                      {row.months.map((m) => (
                        <TableCell
                          key={`${row.employerId}-${m.year}-${m.month}`}
                          className="text-center align-middle"
                          data-testid={`cell-${row.employerId}-${m.year}-${m.month}`}
                        >
                          {m.status ? (
                            <button
                              type="button"
                              className={`text-xs px-2 py-1 rounded border ${statusToVariant(m.status)}`}
                              onClick={() =>
                                m.wizardId && setLocation(`/wizards/${m.wizardId}`)
                              }
                            >
                              {m.status.replace("_", " ")}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ))}
                      {selectedAccountIds.map((accId) => {
                        const v = row.balances[accId];
                        const num = v === null || v === undefined ? null : Number(v);
                        return (
                          <TableCell
                            key={accId}
                            className={`text-right tabular-nums ${
                              num !== null && num > 0 ? "text-destructive" : ""
                            }`}
                          >
                            {num === null ? "—" : num.toFixed(2)}
                          </TableCell>
                        );
                      })}
                      {selectedAccountIds.length > 1 && (
                        <TableCell className="text-right tabular-nums font-semibold">
                          {Number(row.totalBalance).toFixed(2)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Queue Bulk Message Draft</DialogTitle>
            <DialogDescription>
              Create a draft bulk message with contacts resolved from the selected employers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="bulk-name" className="mb-1 block">Draft name</Label>
              <Input
                id="bulk-name"
                value={bulkName}
                onChange={(e) => setBulkName(e.target.value)}
                data-testid="input-bulk-name"
              />
            </div>
            <div>
              <Label className="mb-2 block">Channels</Label>
              <div className="grid grid-cols-2 gap-2">
                {MEDIA_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={bulkMedia.includes(opt.value)}
                      onCheckedChange={(c) => toggleMedium(opt.value, Boolean(c))}
                      data-testid={`checkbox-medium-${opt.value}`}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Contact Types</Label>
              {contactTypes.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No contact types configured.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                  {contactTypes.map((ct) => (
                    <label key={ct.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={selectedContactTypeIds.includes(ct.id)}
                        onCheckedChange={(c) => toggleContactType(ct.id, Boolean(c))}
                        data-testid={`checkbox-contact-type-${ct.id}`}
                      />
                      <span className="text-sm">{ct.displayName ?? ct.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Leave all unchecked to include every contact attached to the selected employers.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{selectedEmployerIds.size} employers</Badge>
              {bulkMedia.length > 0 && (
                <Badge variant="secondary">{bulkMedia.length} channels</Badge>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button
              onClick={() => queueBulkMutation.mutate()}
              disabled={
                queueBulkMutation.isPending ||
                bulkName.trim() === "" ||
                bulkMedia.length === 0 ||
                selectedEmployerIds.size === 0
              }
              data-testid="button-confirm-queue-bulk"
            >
              {queueBulkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
