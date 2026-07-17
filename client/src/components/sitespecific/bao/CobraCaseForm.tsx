import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, X } from "lucide-react";
import {
  BAO_COBRA_CASE_SOURCES,
  type BaoCobraCaseSource,
} from "@shared/schema/sitespecific/bao/schema";

const NONE = "__none__";

export interface CobraStatusOption {
  id: string;
  name: string;
  closed: boolean;
}

export interface CobraQualifyingEventOption {
  id: string;
  name: string;
}

interface TrustBenefitOption {
  id: string;
  name: string;
}

interface WorkerSearchHit {
  id: string;
  displayName: string | null;
  siriusId: number | null;
}

export interface CobraCaseFormValues {
  source: BaoCobraCaseSource;
  statusId: string;
  qualifyingEventId: string | null;
  coveredPersonWorkerId: string;
  subscriberWorkerId: string;
  relationship: string | null;
  cobraEffectiveYmd: string;
  electionMadeYmd: string | null;
  paymentStatus: string | null;
  medicalBenefitLostId: string | null;
  dentalBenefitLostId: string | null;
}

export interface CobraCaseFormInitial extends Partial<CobraCaseFormValues> {
  coveredPersonName?: string | null;
  subscriberName?: string | null;
}

const SOURCE_LABELS: Record<BaoCobraCaseSource, string> = {
  wmb_event: "WMB Event",
  life_event: "Life Event",
  manual: "Manual",
};

export function cobraSourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  return SOURCE_LABELS[source as BaoCobraCaseSource] ?? source;
}

function WorkerPicker({
  label,
  workerId,
  workerName,
  onChange,
  testId,
}: {
  label: string;
  workerId: string;
  workerName: string;
  onChange: (id: string, name: string) => void;
  testId: string;
}) {
  const [query, setQuery] = useState("");

  const { data: searchData } = useQuery<{ workers: WorkerSearchHit[]; total: number }>({
    queryKey: ["/api/workers/search", query],
    queryFn: async () => {
      const response = await fetch(`/api/workers/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled: query.trim().length >= 2,
  });

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {workerId ? (
        <div className="flex items-center gap-2">
          <span className="font-medium" data-testid={`text-${testId}-selected`}>
            {workerName || workerId}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("", "")}
            data-testid={`button-clear-${testId}`}
          >
            <X size={14} />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={16}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workers by name, ID, or SSN"
            className="pl-9"
            data-testid={`input-${testId}-search`}
          />
          {query.trim().length >= 2 && (searchData?.workers?.length ?? 0) > 0 && (
            <div className="mt-2 border rounded-lg divide-y max-h-60 overflow-y-auto">
              {searchData!.workers.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    onChange(w.id, w.displayName ?? "");
                    setQuery("");
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-muted"
                  data-testid={`button-pick-${testId}-${w.id}`}
                >
                  {w.displayName || "Unknown"}{" "}
                  <span className="text-muted-foreground text-sm">
                    {w.siriusId != null ? `#${w.siriusId}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CobraCaseFormProps {
  initial?: CobraCaseFormInitial;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (values: CobraCaseFormValues) => void;
  onCancel: () => void;
  /** Covered person / subscriber cannot change on an existing case. */
  lockWorkers?: boolean;
}

export function CobraCaseForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
  lockWorkers = false,
}: CobraCaseFormProps) {
  const [source, setSource] = useState<BaoCobraCaseSource>(initial?.source ?? "manual");
  const [statusId, setStatusId] = useState(initial?.statusId ?? "");
  const [qualifyingEventId, setQualifyingEventId] = useState(
    initial?.qualifyingEventId ?? NONE,
  );
  const [coveredPersonWorkerId, setCoveredPersonWorkerId] = useState(
    initial?.coveredPersonWorkerId ?? "",
  );
  const [coveredPersonName, setCoveredPersonName] = useState(
    initial?.coveredPersonName ?? "",
  );
  const [subscriberWorkerId, setSubscriberWorkerId] = useState(
    initial?.subscriberWorkerId ?? "",
  );
  const [subscriberName, setSubscriberName] = useState(initial?.subscriberName ?? "");
  const [relationship, setRelationship] = useState(initial?.relationship ?? "");
  const [cobraEffectiveYmd, setCobraEffectiveYmd] = useState(
    (initial?.cobraEffectiveYmd ?? "").slice(0, 10),
  );
  const [electionMadeYmd, setElectionMadeYmd] = useState(
    (initial?.electionMadeYmd ?? "").slice(0, 10),
  );
  const [paymentStatus, setPaymentStatus] = useState(initial?.paymentStatus ?? "");
  const [medicalBenefitLostId, setMedicalBenefitLostId] = useState(
    initial?.medicalBenefitLostId ?? NONE,
  );
  const [dentalBenefitLostId, setDentalBenefitLostId] = useState(
    initial?.dentalBenefitLostId ?? NONE,
  );

  const { data: statuses = [] } = useQuery<CobraStatusOption[]>({
    queryKey: ["/api/options/bao-cobra-status"],
  });
  const { data: events = [] } = useQuery<CobraQualifyingEventOption[]>({
    queryKey: ["/api/options/bao-cobra-qualifying-event"],
  });
  const { data: benefits = [] } = useQuery<TrustBenefitOption[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const valid =
    statusId &&
    coveredPersonWorkerId &&
    subscriberWorkerId &&
    /^\d{4}-\d{2}-\d{2}$/.test(cobraEffectiveYmd) &&
    (electionMadeYmd === "" || /^\d{4}-\d{2}-\d{2}$/.test(electionMadeYmd));

  const handleSubmit = () => {
    onSubmit({
      source,
      statusId,
      qualifyingEventId: qualifyingEventId === NONE ? null : qualifyingEventId,
      coveredPersonWorkerId,
      subscriberWorkerId,
      relationship: relationship.trim() === "" ? null : relationship.trim(),
      cobraEffectiveYmd,
      electionMadeYmd: electionMadeYmd === "" ? null : electionMadeYmd,
      paymentStatus: paymentStatus.trim() === "" ? null : paymentStatus.trim(),
      medicalBenefitLostId: medicalBenefitLostId === NONE ? null : medicalBenefitLostId,
      dentalBenefitLostId: dentalBenefitLostId === NONE ? null : dentalBenefitLostId,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lockWorkers ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Covered Person</p>
                <p className="font-medium" data-testid="text-covered-person-locked">
                  {coveredPersonName || coveredPersonWorkerId}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Subscriber</p>
                <p className="font-medium" data-testid="text-subscriber-locked">
                  {subscriberName || subscriberWorkerId}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <WorkerPicker
                label="Covered Person"
                workerId={coveredPersonWorkerId}
                workerName={coveredPersonName}
                onChange={(id, name) => {
                  setCoveredPersonWorkerId(id);
                  setCoveredPersonName(name);
                }}
                testId="covered-person"
              />
              <WorkerPicker
                label="Subscriber"
                workerId={subscriberWorkerId}
                workerName={subscriberName}
                onChange={(id, name) => {
                  setSubscriberWorkerId(id);
                  setSubscriberName(name);
                }}
                testId="subscriber"
              />
            </div>
          )}
          <div className="space-y-1 max-w-sm">
            <Label>Relationship to Subscriber</Label>
            <Input
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="self, spouse, child, ..."
              data-testid="input-relationship"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Case</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as BaoCobraCaseSource)}>
              <SelectTrigger data-testid="select-case-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAO_COBRA_CASE_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={statusId} onValueChange={setStatusId}>
              <SelectTrigger data-testid="select-case-status">
                <SelectValue placeholder="Select a status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Qualifying Event</Label>
            <Select value={qualifyingEventId} onValueChange={setQualifyingEventId}>
              <SelectTrigger data-testid="select-case-event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {events.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>
                    {ev.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Benefit End / COBRA Effective Date</Label>
            <Input
              type="date"
              value={cobraEffectiveYmd}
              onChange={(e) => setCobraEffectiveYmd(e.target.value)}
              data-testid="input-effective-ymd"
            />
            <p className="text-xs text-muted-foreground">
              Offer, election, payment, and max-period deadlines are calculated
              automatically from this date.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Election Made</Label>
            <Input
              type="date"
              value={electionMadeYmd}
              onChange={(e) => setElectionMadeYmd(e.target.value)}
              data-testid="input-election-ymd"
            />
          </div>
          <div className="space-y-1">
            <Label>Payment Status</Label>
            <Input
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              placeholder="e.g. current, late"
              data-testid="input-payment-status"
            />
          </div>
          <div className="space-y-1">
            <Label>Medical Benefit Lost</Label>
            <Select value={medicalBenefitLostId} onValueChange={setMedicalBenefitLostId}>
              <SelectTrigger data-testid="select-medical-benefit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {benefits.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Dental Benefit Lost</Label>
            <Select value={dentalBenefitLostId} onValueChange={setDentalBenefitLostId}>
              <SelectTrigger data-testid="select-dental-benefit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {benefits.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-case">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!valid || submitting}
          data-testid="button-submit-case"
        >
          {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
