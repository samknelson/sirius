import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "@/lib/date-format";
import { Building2, Loader2, Send, AlertCircle, Download } from "lucide-react";

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
import { BulkTemplateSelector, type BulkTemplateIds } from "@/components/bulk/bulk-template-selector";
import {
  getEditableNotStartedBulkMessages,
  type ExistingBulkMessageOption,
} from "@/components/bulk/existing-message-chooser-content";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { WizardType } from "@/lib/wizard-types";
import type { LedgerAccount } from "@/lib/ledger-types";

type StatusFilter =
  | "all"
  | "missing_current"
  | "incomplete"
  | "completed"
  | "any_overdue"
  | "missing_last_2"
  | "missing_last_3"
  | "missing_last_6";

type BalanceFilter = "all" | "positive" | "negative" | "nonzero" | "threshold";

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
  balanceDelta: string | null;
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
  scope: import("@shared/employer-compliance").ComplianceScope;
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

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function isMonthMissing(m: MonthCell): boolean {
  return !m.status || (m.status !== "completed" && m.status !== "cancelled");
}

function isMonthDelinquent(m: MonthCell): boolean {
  return m.balanceDelta !== null && Number(m.balanceDelta) > 0;
}

export default function EmployerComplianceDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { hasComponent, hasPermission } = useAuth();
  const canExport = hasPermission("staff") || hasPermission("admin");
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
  const [balanceThreshold, setBalanceThreshold] = useState<string>(
    () => readQueryParam("balanceMin") ?? "",
  );

  const [selectedEmployerIds, setSelectedEmployerIds] = useState<Set<string>>(new Set());
  const [selectedContactTypeIds, setSelectedContactTypeIds] = useState<string[]>([]);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkName, setBulkName] = useState("");
  const [bulkMedia, setBulkMedia] = useState<Array<"sms" | "email" | "inapp" | "postal">>(["email"]);
  const [bulkTarget, setBulkTarget] = useState<"new" | "existing">("new");
  const [bulkMessageId, setBulkMessageId] = useState<string | null>(null);
  const [bulkTemplateIds, setBulkTemplateIds] = useState<BulkTemplateIds>({});

  const [isExporting, setIsExporting] = useState(false);

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

  const bulkMessagesQuery = useQuery<ExistingBulkMessageOption[]>({
    queryKey: ["/api/bulk-messages"],
    queryFn: () => apiRequest("GET", "/api/bulk-messages"),
    enabled: bulkOpen,
    staleTime: 30000,
  });
  const eligibleExistingMessages = getEditableNotStartedBulkMessages(bulkMessagesQuery.data ?? []);
  const selectedBulkMessage = eligibleExistingMessages.find((message) => message.id === bulkMessageId);
  const selectedBulkMedia = bulkTarget === "existing"
    ? (selectedBulkMessage?.medium ?? []).filter((medium): medium is "sms" | "email" | "inapp" | "postal" =>
      MEDIA_OPTIONS.some((option) => option.value === medium))
    : bulkMedia;
  const canApplyTemplates = bulkTarget === "new" || selectedBulkMessage?.status === "draft";

  const dashboardEnabled = Boolean(wizardType);
  const { data, isLoading, error, refetch } = useQuery<DashboardResponse>({
    queryKey: [
      "/api/employer-compliance/dashboard",
      {
        year,
        month,
        wizardType,
        monthsBack: 6,
        ledgerAccountIds: selectedAccountIds.join(","),
        companyId: companyFilter !== "all" ? companyFilter : "",
      },
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
    if (balanceFilter === "threshold" && balanceThreshold) {
      params.set("balanceMin", balanceThreshold);
    }
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
    balanceThreshold,
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
        const isMissing = (m: MonthCell | undefined) =>
          !m || !m.status || (m.status !== "completed" && m.status !== "cancelled");
        if (statusFilter === "missing_current") {
          if (last && last.status) return false;
        } else if (statusFilter === "completed") {
          if (!last || last.status !== "completed") return false;
        } else if (statusFilter === "incomplete") {
          if (!last || last.status === "completed") return false;
        } else if (statusFilter === "any_overdue") {
          const hasOverdue = row.months.slice(0, -1).some(isMissing);
          if (!hasOverdue) return false;
        } else if (statusFilter === "missing_last_2") {
          const window = row.months.slice(-2);
          if (!window.some(isMissing)) return false;
        } else if (statusFilter === "missing_last_3") {
          const window = row.months.slice(-3);
          if (!window.some(isMissing)) return false;
        } else if (statusFilter === "missing_last_6") {
          if (!row.months.some(isMissing)) return false;
        }
      }
      if (balanceFilter !== "all" && selectedAccountIds.length > 0) {
        const total = Number(row.totalBalance);
        if (balanceFilter === "positive" && !(total > 0)) return false;
        if (balanceFilter === "negative" && !(total < 0)) return false;
        if (balanceFilter === "nonzero" && total === 0) return false;
        if (balanceFilter === "threshold") {
          const min = Number(balanceThreshold);
          if (!Number.isFinite(min)) return false;
          if (!(total >= min)) return false;
        }
      }
      return true;
    });
  }, [
    rows,
    nameSearch,
    companyFilter,
    statusFilter,
    balanceFilter,
    balanceThreshold,
    selectedAccountIds.length,
  ]);

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
      if (!data) throw new Error("Run the compliance report before queueing a letter");
      const targetIsExisting = bulkTarget === "existing";
      return await apiRequest("POST", "/api/employer-compliance/queue-bulk", {
        ...(!targetIsExisting ? { name: bulkName, medium: bulkMedia } : { bulkMessageId }),
        employerIds: Array.from(selectedEmployerIds),
        contactTypeIds: selectedContactTypeIds,
        reportScope: data.scope,
        ...(Object.keys(bulkTemplateIds).length ? { templateIds: bulkTemplateIds } : {}),
      });
    },
    onSuccess: (resp: any) => {
      const missing = Array.isArray(resp.employersWithoutContacts)
        ? resp.employersWithoutContacts.length
        : 0;
      const failed = Number(resp.participantFailures ?? 0);
      const warn = missing > 0 || failed > 0;
      const skipped = Number(resp.participantsSkipped ?? 0);
      const resolvedSummary = bulkTarget === "existing"
        ? `Added ${Number(resp.participantsCreated ?? 0)} of ${Number(resp.participantsExpected ?? resp.participantsCreated ?? 0)} recipient/channel entries from ${resp.contactCount} contacts across ${resp.employerCount} employers.`
        : `Resolved ${resp.contactCount} contact${resp.contactCount === 1 ? "" : "s"} across ${resp.employerCount} employer${resp.employerCount === 1 ? "" : "s"}.`;
      toast({
        title: bulkTarget === "existing" ? "Recipients added to message" : "Bulk message draft created",
        description:
          resolvedSummary +
          (missing > 0
            ? ` ${missing} employer${missing === 1 ? " has" : "s have"} no matching contacts.`
            : "") +
          (failed > 0
            ? ` ${failed} participant write${failed === 1 ? "" : "s"} failed — review the draft.`
            : "") +
          (skipped > 0 ? ` ${skipped} participant${skipped === 1 ? " was" : "s were"} already enrolled.` : ""),
        variant: warn ? "destructive" : undefined,
      });
      setBulkOpen(false);
      setBulkName("");
      setBulkTarget("new");
      setBulkMessageId(null);
      setBulkTemplateIds({});
      setSelectedEmployerIds(new Set());
      if (resp.bulkMessageId) {
        setLocation(`/bulk/${resp.bulkMessageId}`);
      }
    },
    onError: (err: any) => {
      toast({
        title: "Failed to queue bulk message",
        description: getApiErrorMessage(err, "Unknown error"),
        variant: "destructive",
      });
    },
  });

  const handleExport = async () => {
    if (!wizardType) {
      toast({ title: "Select an upload type first", variant: "destructive" });
      return;
    }
    if (selectedAccountIds.length === 0) {
      toast({
        title: "Select at least one ledger account",
        description: "Delinquent amounts can't be computed without an account.",
        variant: "destructive",
      });
      return;
    }

    const monthLabelFor = (m: MonthCell) =>
      format(new Date(m.year, m.month - 1, 1), "MMM yyyy");

    const exportRows = filteredRows
      .map((row) => {
        const monthsNeedingReporting = row.months.filter(isMonthMissing);
        const delinquentMonths = row.months.filter(isMonthDelinquent);
        return { row, monthsNeedingReporting, delinquentMonths };
      })
      .filter(
        (r) =>
          r.monthsNeedingReporting.length > 0 || r.delinquentMonths.length > 0,
      );

    if (exportRows.length === 0) {
      toast({
        title: "Nothing to export",
        description:
          "No employers have an incomplete month or an unpaid balance for the current filters.",
      });
      return;
    }

    setIsExporting(true);
    try {
      const resp: any = await apiRequest(
        "POST",
        "/api/employer-compliance/resolve-contacts",
        { employerIds: exportRows.map((r) => r.row.employerId) },
      );

      const contactsByEmployer = new Map<string, string[]>();
      const contactList: Array<{
        employerId: string;
        displayName: string | null;
        email: string | null;
      }> = Array.isArray(resp?.contacts) ? resp.contacts : [];
      for (const c of contactList) {
        const name = (c.displayName ?? "").trim();
        const email = (c.email ?? "").trim();
        let label = "";
        if (name && email) label = `${name} <${email}>`;
        else if (name) label = name;
        else if (email) label = email;
        if (!label) continue;
        const arr = contactsByEmployer.get(c.employerId) ?? [];
        arr.push(label);
        contactsByEmployer.set(c.employerId, arr);
      }

      const header = [
        "Employer",
        "Sirius ID",
        ...(companyEnabled ? ["Company"] : []),
        "Contacts",
        "Months Needing Reporting",
        "Delinquent Amounts by Month",
      ];
      const out: (string | number | null)[][] = [header];

      for (const { row, monthsNeedingReporting, delinquentMonths } of exportRows) {
        out.push([
          row.employerName,
          row.siriusId,
          ...(companyEnabled ? [row.companyName ?? ""] : []),
          (contactsByEmployer.get(row.employerId) ?? []).join("; "),
          monthsNeedingReporting.map(monthLabelFor).join("; "),
          delinquentMonths
            .map((m) => `${monthLabelFor(m)}: ${Number(m.balanceDelta).toFixed(2)}`)
            .join("; "),
        ]);
      }

      const fname = `compliance-export-${wizardType}-${year}-${String(month).padStart(2, "0")}.csv`;
      downloadCsv(fname.replace(/[^a-z0-9.\-_]+/gi, "_"), out);

      toast({
        title: "Export ready",
        description: `Exported ${exportRows.length} employer${
          exportRows.length === 1 ? "" : "s"
        }.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to export",
        description: getApiErrorMessage(err, "Unknown error"),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

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
                  <SelectItem value="missing_last_2">Missing in last 2 months</SelectItem>
                  <SelectItem value="missing_last_3">Missing in last 3 months</SelectItem>
                  <SelectItem value="missing_last_6">Missing in last 6 months</SelectItem>
                  <SelectItem value="incomplete">Current month not completed</SelectItem>
                  <SelectItem value="completed">Current month completed</SelectItem>
                  <SelectItem value="any_overdue">Any prior month overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">Balance</Label>
              <div className="flex gap-2">
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
                    <SelectItem value="threshold">≥ threshold</SelectItem>
                  </SelectContent>
                </Select>
                {balanceFilter === "threshold" && (
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Min"
                    className="w-24"
                    value={balanceThreshold}
                    onChange={(e) => setBalanceThreshold(e.target.value)}
                    data-testid="input-balance-threshold"
                  />
                )}
              </div>
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
            {canExport && (
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={isExporting}
                data-testid="button-export-compliance"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Export CSV
              </Button>
            )}
            <Button
              onClick={() => {
                if (selectedEmployerIds.size === 0) {
                  toast({
                    title: "Select at least one employer",
                    variant: "destructive",
                  });
                  return;
                }
                if (bulkTarget === "new" && !bulkName) {
                  setBulkName(
                    `Compliance follow-up ${format(new Date(), "yyyy-MM-dd")}`,
                  );
                }
                setBulkTarget("new");
                setBulkMessageId(null);
                setBulkTemplateIds({});
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
                          <div className="flex flex-col items-center gap-1">
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
                            {selectedAccountIds.length > 0 && (
                              <span
                                className={`text-[11px] tabular-nums ${
                                  m.balanceDelta === null
                                    ? "text-muted-foreground"
                                    : Number(m.balanceDelta) > 0
                                      ? "text-destructive"
                                      : Number(m.balanceDelta) < 0
                                        ? "text-emerald-600"
                                        : "text-muted-foreground"
                                }`}
                                title="Net invoice activity for this month across selected accounts"
                                data-testid={`delta-${row.employerId}-${m.year}-${m.month}`}
                              >
                                {m.balanceDelta === null
                                  ? "—"
                                  : Number(m.balanceDelta).toFixed(2)}
                              </span>
                            )}
                          </div>
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

      <Dialog open={bulkOpen} onOpenChange={(open) => {
        if (!queueBulkMutation.isPending) {
          setBulkOpen(open);
          if (!open) {
            setBulkTarget("new");
            setBulkMessageId(null);
            setBulkTemplateIds({});
          }
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Queue bulk message</DialogTitle>
            <DialogDescription>
              Resolve contacts from {selectedEmployerIds.size} selected employers and add them to a new or existing message.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label htmlFor="bulk-target">Message</Label>
              <Select
                value={bulkTarget}
                onValueChange={(value) => {
                  setBulkTarget(value as "new" | "existing");
                  setBulkMessageId(null);
                  setBulkTemplateIds({});
                }}
                disabled={queueBulkMutation.isPending}
              >
                <SelectTrigger id="bulk-target" data-testid="select-bulk-target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create a new draft</SelectItem>
                  <SelectItem value="existing">Add to an existing message</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bulkTarget === "existing" ? (
              <div className="space-y-2">
                <Label htmlFor="bulk-existing-message">Existing message</Label>
                {bulkMessagesQuery.isLoading ? (
                  <div role="status" aria-label="Loading messages" className="space-y-2">
                    <div className="h-10 animate-pulse rounded-md border bg-muted/60" />
                    <div className="h-10 animate-pulse rounded-md border bg-muted/60" />
                  </div>
                ) : bulkMessagesQuery.isError ? (
                  <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-3">
                    <span>Messages couldn’t be loaded. Try again.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void bulkMessagesQuery.refetch()} disabled={bulkMessagesQuery.isFetching}>Retry</Button>
                  </AlertDescription></Alert>
                ) : eligibleExistingMessages.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No editable, not-yet-started drafts are available. Create a new draft instead.
                  </div>
                ) : (
                  <Select
                    value={bulkMessageId ?? ""}
                    onValueChange={(id) => {
                      setBulkMessageId(id);
                      setBulkTemplateIds({});
                    }}
                    disabled={queueBulkMutation.isPending}
                  >
                    <SelectTrigger id="bulk-existing-message" data-testid="select-existing-bulk-message">
                      <SelectValue placeholder="Choose a message" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleExistingMessages.map((message) => (
                        <SelectItem key={message.id} value={message.id}>
                          {message.name} · {message.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedBulkMessage && (
                  <p className="text-xs text-muted-foreground">
                    Channels on this message: {selectedBulkMedia.length ? selectedBulkMedia.join(", ") : "none"}.
                  </p>
                )}
              </div>
            ) : (
              <>
              <div>
              <Label htmlFor="bulk-name" className="mb-1 block">Draft name</Label>
              <Input
                id="bulk-name"
                value={bulkName}
                onChange={(e) => setBulkName(e.target.value)}
                disabled={queueBulkMutation.isPending}
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
                      disabled={queueBulkMutation.isPending}
                      onCheckedChange={(c) => {
                        toggleMedium(opt.value, Boolean(c));
                        setBulkTemplateIds((previous) => {
                          const next = { ...previous };
                          if (!c) delete next[opt.value];
                          return next;
                        });
                      }}
                      data-testid={`checkbox-medium-${opt.value}`}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
              </>
            )}
            {canApplyTemplates && selectedBulkMedia.length > 0 && (
              <>
                <BulkTemplateSelector
                  media={selectedBulkMedia}
                  value={bulkTemplateIds}
                  onChange={setBulkTemplateIds}
                  disabled={queueBulkMutation.isPending}
                  testIdPrefix="employer-compliance"
                />
                {bulkTarget === "existing" && Object.keys(bulkTemplateIds).length > 0 && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Applying templates replaces authored fields on this draft for all of its recipients. Other message and delivery settings remain unchanged.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
            {bulkTarget === "existing" && selectedBulkMessage && !canApplyTemplates && (
              <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                Templates can only be applied to editable drafts. Adding recipients to this message will leave its content unchanged.
              </p>
            )}
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
                        disabled={queueBulkMutation.isPending}
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
              {selectedBulkMedia.length > 0 && (
                <Badge variant="secondary">{selectedBulkMedia.length} channels</Badge>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={queueBulkMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => queueBulkMutation.mutate()}
              disabled={
                queueBulkMutation.isPending ||
                (bulkTarget === "new" && (bulkName.trim() === "" || bulkMedia.length === 0)) ||
                (bulkTarget === "existing" && (!bulkMessageId || selectedBulkMedia.length === 0 || bulkMessagesQuery.isError)) ||
                selectedEmployerIds.size === 0
              }
              data-testid="button-confirm-queue-bulk"
            >
              {queueBulkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {bulkTarget === "existing" ? "Add recipients" : "Create Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
