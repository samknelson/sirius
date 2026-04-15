import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@shared/currency";
import { Loader2, AlertCircle } from "lucide-react";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface InvoiceSummary {
  month: number;
  year: number;
  totalAmount: string;
  entryCount: number;
  incomingBalance: string;
  invoiceBalance: string;
  outgoingBalance: string;
}

export interface StatementSelection {
  month: number;
  year: number;
  amount?: string;
}

interface StatementPickerProps {
  eaId: string | null;
  currencyCode: string;
  paymentAmount: string;
  selections: StatementSelection[];
  onSelectionsChange: (selections: StatementSelection[]) => void;
  manualMonth: string;
  manualYear: string;
  onManualMonthChange: (month: string) => void;
  onManualYearChange: (year: string) => void;
}

export function StatementPicker({
  eaId,
  currencyCode,
  paymentAmount,
  selections,
  onSelectionsChange,
  manualMonth,
  manualYear,
  onManualMonthChange,
  onManualYearChange,
}: StatementPickerProps) {
  const [useManual, setUseManual] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const prevEaIdRef = useRef<string | null>(eaId);
  const prevSelectionsLenRef = useRef(selections.length);

  const { data: invoices, isLoading, isError } = useQuery<InvoiceSummary[]>({
    queryKey: ["/api/ledger/ea", eaId, "invoices"],
    queryFn: async () => {
      return await apiRequest("GET", `/api/ledger/ea/${eaId}/invoices`);
    },
    enabled: !!eaId,
  });

  useEffect(() => {
    if (prevEaIdRef.current !== eaId) {
      const wasEmpty = !prevEaIdRef.current;
      prevEaIdRef.current = eaId;
      if (!wasEmpty) {
        setUseManual(false);
        setMultiMode(false);
        onSelectionsChange([]);
        onManualMonthChange("");
        onManualYearChange("");
      }
    }
  }, [eaId]);

  useEffect(() => {
    if (selections.length > 1 && prevSelectionsLenRef.current <= 1) {
      setMultiMode(true);
    }
    prevSelectionsLenRef.current = selections.length;
  }, [selections.length]);

  useEffect(() => {
    if (invoices && invoices.length === 0 && eaId) {
      setUseManual(true);
    }
  }, [invoices, eaId]);

  useEffect(() => {
    if (!multiMode && selections.length > 1) {
      onSelectionsChange([selections[0]]);
    }
  }, [multiMode]);

  if (!eaId) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">Statement Period</label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Month</label>
            <Select value={manualMonth} onValueChange={onManualMonthChange}>
              <SelectTrigger>
                <SelectValue placeholder="Month (optional)" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Year</label>
            <Input
              type="number"
              min="2000"
              max="2099"
              placeholder="Year (optional)"
              value={manualYear}
              onChange={(e) => onManualYearChange(e.target.value)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">Statement Period</label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading statements...
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">Statement Period</label>
        <div className="flex items-center gap-2 text-sm text-destructive py-2">
          <AlertCircle className="h-4 w-4" />
          Failed to load statements.
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Month</label>
            <Select value={manualMonth} onValueChange={onManualMonthChange}>
              <SelectTrigger>
                <SelectValue placeholder="Month (optional)" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Year</label>
            <Input
              type="number"
              min="2000"
              max="2099"
              placeholder="Year (optional)"
              value={manualYear}
              onChange={(e) => onManualYearChange(e.target.value)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (useManual) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Statement Period</label>
          {invoices && invoices.length > 0 && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => {
                setUseManual(false);
                onManualMonthChange("");
                onManualYearChange("");
              }}
            >
              Pick from statements
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Month</label>
            <Select value={manualMonth} onValueChange={onManualMonthChange}>
              <SelectTrigger>
                <SelectValue placeholder="Month (optional)" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Year</label>
            <Input
              type="number"
              min="2000"
              max="2099"
              placeholder="Year (optional)"
              value={manualYear}
              onChange={(e) => onManualYearChange(e.target.value)}
            />
          </div>
        </div>
      </div>
    );
  }

  const sortedInvoices = invoices
    ? [...invoices].sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      })
    : [];

  const isSelected = (inv: InvoiceSummary) =>
    selections.some((s) => s.month === inv.month && s.year === inv.year);

  const handleRowClick = (inv: InvoiceSummary) => {
    if (multiMode) {
      if (isSelected(inv)) {
        const next = selections.filter(
          (s) => !(s.month === inv.month && s.year === inv.year)
        );
        onSelectionsChange(next);
      } else {
        onSelectionsChange([...selections, { month: inv.month, year: inv.year }]);
      }
    } else {
      if (isSelected(inv) && selections.length === 1) {
        onSelectionsChange([]);
      } else {
        onSelectionsChange([{ month: inv.month, year: inv.year }]);
      }
    }
  };

  const updateAmount = (month: number, year: number, amount: string) => {
    onSelectionsChange(
      selections.map((s) =>
        s.month === month && s.year === year ? { ...s, amount } : s
      )
    );
  };

  const paymentNum = parseFloat(paymentAmount) || 0;
  const allocatedTotal = selections.reduce(
    (sum, s) => sum + (parseFloat(s.amount || "0") || 0),
    0
  );
  const remaining = paymentNum - allocatedTotal;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Statement Period</label>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => {
            setUseManual(true);
            setMultiMode(false);
            onSelectionsChange([]);
          }}
        >
          Enter manually
        </Button>
      </div>

      {sortedInvoices.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No statements found for this participant.
        </p>
      ) : (
        <div className="border rounded-md max-h-[240px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-2 font-medium w-8"></th>
                <th className="text-left p-2 font-medium">Period</th>
                <th className="text-right p-2 font-medium">Charges</th>
                <th className="text-right p-2 font-medium">Balance</th>
                {multiMode && (
                  <th className="text-right p-2 font-medium w-28">Apply</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.map((inv) => {
                const selected = isSelected(inv);
                const sel = selections.find(
                  (s) => s.month === inv.month && s.year === inv.year
                );
                return (
                  <tr
                    key={`${inv.year}-${inv.month}`}
                    className={`border-t cursor-pointer hover:bg-muted/30 ${
                      selected ? "bg-primary/5" : ""
                    }`}
                    onClick={() => handleRowClick(inv)}
                  >
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => handleRowClick(inv)}
                      />
                    </td>
                    <td className="p-2">
                      {MONTH_NAMES[inv.month - 1]} {inv.year}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatAmount(parseFloat(inv.totalAmount), currencyCode)}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      <span
                        className={
                          parseFloat(inv.outgoingBalance) > 0
                            ? "text-red-600"
                            : parseFloat(inv.outgoingBalance) < 0
                            ? "text-green-600"
                            : ""
                        }
                      >
                        {formatAmount(
                          parseFloat(inv.outgoingBalance),
                          currencyCode
                        )}
                      </span>
                    </td>
                    {multiMode && (
                      <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                        {selected && (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Amount required"
                            className={`h-7 w-28 text-right text-sm ${
                              sel && (!sel.amount || parseFloat(sel.amount) <= 0)
                                ? "border-red-400 focus-visible:ring-red-400"
                                : ""
                            }`}
                            value={sel?.amount || ""}
                            onChange={(e) =>
                              updateAmount(inv.month, inv.year, e.target.value)
                            }
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selections.length === 1 && !multiMode && (
        <p className="text-xs text-muted-foreground">
          Selected: {MONTH_NAMES[selections[0].month - 1]} {selections[0].year}.{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => setMultiMode(true)}
          >
            Split across multiple statements
          </button>
        </p>
      )}

      {multiMode && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {selections.length} statement{selections.length !== 1 ? "s" : ""} selected
              {" \u2014 "}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => setMultiMode(false)}
              >
                single statement
              </button>
            </span>
            <span
              className={
                Math.abs(remaining) < 0.01
                  ? "text-green-600"
                  : "text-red-600 font-medium"
              }
            >
              {Math.abs(remaining) < 0.01
                ? "Fully allocated"
                : `${formatAmount(remaining, currencyCode)} remaining`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
