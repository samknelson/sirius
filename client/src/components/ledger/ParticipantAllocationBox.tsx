import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatementPicker, type StatementSelection } from "@/components/ledger/StatementPicker";
import { Trash2 } from "lucide-react";

export interface ParticipantBoxState {
  _id?: number;
  eaId: string;
  amount: string;
  statementSelections: StatementSelection[];
  manualMonth: string;
  manualYear: string;
}

export type ParticipantBoxUpdate =
  | Partial<ParticipantBoxState>
  | ((current: ParticipantBoxState) => Partial<ParticipantBoxState> | ParticipantBoxState);

interface EAOption {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
}

interface ParticipantAllocationBoxProps {
  state: ParticipantBoxState;
  onChange: (update: ParticipantBoxUpdate) => void;
  onRemove?: () => void;
  eaOptions: EAOption[];
  currencyCode: string;
  index: number;
  usedEaIds: string[];
}

export function ParticipantAllocationBox({
  state,
  onChange,
  onRemove,
  eaOptions,
  currencyCode,
  index,
  usedEaIds,
}: ParticipantAllocationBoxProps) {
  const availableEAs = eaOptions.filter(
    (ea) => ea.id === state.eaId || !usedEaIds.includes(ea.id)
  );
  const selectedEA = availableEAs.find((ea) => ea.id === state.eaId);

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          Participant {index + 1}
        </span>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Account</label>
        <Select
          value={state.eaId}
          onValueChange={(val) => {
            // Radix may emit an empty or repeated value while options mount.
            // Only a real user selection should invalidate statement periods.
            if (!val) return;
            onChange((current) => {
              if (val === current.eaId) return current;
              return {
                eaId: val,
                statementSelections: [],
                manualMonth: "",
                manualYear: "",
              };
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a participant...">
              {selectedEA
                ? `${selectedEA.entityName || selectedEA.entityId} (${selectedEA.entityType})`
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableEAs.map((ea) => (
              <SelectItem key={ea.id} value={ea.id}>
                {ea.entityName || ea.entityId} ({ea.entityType})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Allocation Amount</label>
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={state.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
        />
      </div>

      <StatementPicker
        eaId={state.eaId || null}
        currencyCode={currencyCode}
        paymentAmount={state.amount || "0"}
        selections={state.statementSelections}
        onSelectionsChange={(sels) => onChange({ statementSelections: sels })}
        manualMonth={state.manualMonth}
        manualYear={state.manualYear}
        onManualMonthChange={(m) => onChange({ manualMonth: m })}
        onManualYearChange={(y) => onChange({ manualYear: y })}
      />
    </div>
  );
}
