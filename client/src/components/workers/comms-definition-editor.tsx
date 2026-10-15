import { useState, type FormEvent } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { COMM_STATUSES, COMM_STATUS_LABELS } from "@shared/commStatus";
import type {
  BenefitPeriod,
  WorkerCommsDefinition,
  WorkerCommsDefinitionInput,
  WorkerCommsOptions,
} from "@shared/worker-comms-compliance";
import { workerCommsDefinitionSchema } from "@shared/worker-comms-compliance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface CommsDefinitionEditorProps {
  definition?: WorkerCommsDefinition | null;
  options: WorkerCommsOptions;
  isSaving?: boolean;
  onSave: (value: WorkerCommsDefinitionInput) => void;
  onCancel: () => void;
}

type DefinitionForm = Omit<WorkerCommsDefinition, "id">;
type BenefitPeriodMode = BenefitPeriod["mode"];

const CONTACT_STATUSES = [
  ["all", "Any contact status"],
  ["has_email", "Has email"],
  ["missing_email", "Missing email"],
  ["has_phone", "Has phone"],
  ["missing_phone", "Missing phone"],
  ["has_address", "Has address"],
  ["missing_address", "Missing address"],
  ["complete", "Contact details complete"],
  ["incomplete", "Contact details incomplete"],
] as const;

const MEDIUMS = [
  ["", "Any medium"],
  ["email", "Email"],
  ["sms", "SMS"],
  ["postal", "Postal"],
  ["inapp", "In-app"],
] as const;

function MultiChoice({
  label,
  options,
  value,
  onChange,
  disabled = false,
  help,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  help?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.filter((option) => value.includes(option.id));
  const unknownIds = value.filter((id) => !options.some((option) => option.id === id));

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {help && <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>}
      {disabled ? (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Editing this dimension is unavailable. Saved choices are preserved unless you explicitly remove one below.
          {value.length > 0 && (
            <p className="mt-1 text-xs text-foreground/80">
              Saved selection: {[...selected.map((item) => item.name), ...unknownIds].join(", ")}
            </p>
          )}
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((current) => !current)}
            className="flex min-h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
            aria-expanded={open}
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {selected.length ? selected.map((item) => item.name).join(", ") : `All ${label.toLowerCase()}`}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          {open && (
            <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-lg">
              {options.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">No choices are available.</p>
              ) : options.map((option) => {
                const checked = value.includes(option.id);
                return (
                  <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-accent">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => {
                        onChange(next
                          ? [...value, option.id]
                          : value.filter((id) => id !== option.id));
                      }}
                    />
                    <span>{option.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <span key={item.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              {item.name}
              <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onChange(value.filter((id) => id !== item.id))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {unknownIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              Unavailable choice: {id}
              <button type="button" aria-label={`Remove unavailable choice ${id}`} onClick={() => onChange(value.filter((valueId) => valueId !== id))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function emptyDefinition(): DefinitionForm {
  return {
    name: "",
    commTagId: "",
    statuses: ["sent"],
    medium: "",
    sentFrom: "",
    sentThrough: "",
    population: {
      nameIdSearch: "",
      contactSearch: "",
      memberStatusIds: [],
      benefitIds: [],
      employerId: "",
      employerTypeId: "",
      bargainingUnitId: "",
      representativeId: "",
      jobTitle: "",
      hasMultipleEmployers: false,
      contactStatus: "all",
    },
  };
}

export function CommsDefinitionEditor({
  definition,
  options,
  isSaving = false,
  onSave,
  onCancel,
}: CommsDefinitionEditorProps) {
  const [form, setForm] = useState<DefinitionForm>(() =>
    definition ? {
      name: definition.name,
      commTagId: definition.commTagId,
      statuses: [...definition.statuses],
      medium: definition.medium,
      sentFrom: definition.sentFrom,
      sentThrough: definition.sentThrough,
      population: { ...definition.population, memberStatusIds: [...definition.population.memberStatusIds], benefitIds: [...definition.population.benefitIds] },
    } : emptyDefinition(),
  );
  const initialBenefitPeriod = definition?.population.benefitPeriod;
  const [benefitPeriodMode, setBenefitPeriodMode] = useState<BenefitPeriodMode>(initialBenefitPeriod?.mode ?? "current");
  const [lookbackMonths, setLookbackMonths] = useState(
    initialBenefitPeriod?.mode === "lookback" ? String(initialBenefitPeriod.months) : "6",
  );
  const [benefitFrom, setBenefitFrom] = useState(
    initialBenefitPeriod?.mode === "range" ? initialBenefitPeriod.from : "",
  );
  const [benefitThrough, setBenefitThrough] = useState(
    initialBenefitPeriod?.mode === "range" ? initialBenefitPeriod.through : "",
  );
  const [formError, setFormError] = useState("");

  const setPopulation = <K extends keyof WorkerCommsDefinitionInput["population"]>(
    key: K,
    value: DefinitionForm["population"][K],
  ) => setForm((current) => ({ ...current, population: { ...current.population, [key]: value } }));

  const toggleStatus = (status: (typeof COMM_STATUSES)[number]) => {
    setForm((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((item) => item !== status)
        : [...current.statuses, status],
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    const benefitPeriod: BenefitPeriod = benefitPeriodMode === "lookback"
      ? { mode: "lookback", months: Number(lookbackMonths) }
      : benefitPeriodMode === "range"
        ? { mode: "range", from: benefitFrom, through: benefitThrough }
        : { mode: benefitPeriodMode };
    const populationWithoutPeriod = { ...form.population };
    delete populationWithoutPeriod.benefitPeriod;
    const value: WorkerCommsDefinitionInput = {
      ...form,
      name: form.name.trim(),
      population: {
        ...populationWithoutPeriod,
        ...(form.population.benefitIds.length > 0 ? { benefitPeriod } : {}),
      },
    };
    const parsed = workerCommsDefinitionSchema.safeParse(value);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check the definition fields and try again.");
      return;
    }
    onSave(parsed.data);
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary"><Check className="h-4 w-4" /></div>
          <div>
            <h3 className="font-semibold">What counts as evidence</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Compliance compares the configured worker population and benefit-history period with communication-history records carrying the chosen tag and a selected status. Creating or queueing a message alone is not evidence; queued and sending are not delivery confirmation, and offline does not confirm physical receipt.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="definition-name">Definition name</Label>
            <Input id="definition-name" value={form.name} maxLength={150} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="For example, 2025 SPD distribution" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="definition-tag">Evidence communication tag</Label>
            <Select value={form.commTagId} onValueChange={(commTagId) => setForm((current) => ({ ...current, commTagId }))}>
              <SelectTrigger id="definition-tag"><SelectValue placeholder="Choose a tag" /></SelectTrigger>
              <SelectContent>{options.tags.map((tag) => <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">The communication history item must carry this tag and one of the selected statuses.</p>
          </div>
          <div className="space-y-2">
            <Label>Medium</Label>
            <Select value={form.medium || "any"} onValueChange={(value) => setForm((current) => ({ ...current, medium: (value === "any" ? "" : value) as DefinitionForm["medium"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MEDIUMS.map(([value, label]) => <SelectItem key={value || "any"} value={value || "any"}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Communication status</Label>
            <div className="flex flex-wrap gap-2">
              {COMM_STATUSES.map((status) => {
                const active = form.statuses.includes(status);
                return (
                  <button key={status} type="button" onClick={() => toggleStatus(status)} className={cn("rounded-md border px-3 py-1.5 text-sm transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent")}>
                    {COMM_STATUS_LABELS[status]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Statuses describe the communication record, not whether someone physically received an offline item.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sent-from">Sent from</Label>
            <Input id="sent-from" type="date" value={form.sentFrom} onChange={(event) => setForm((current) => ({ ...current, sentFrom: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sent-through">Sent through</Label>
            <Input id="sent-through" type="date" value={form.sentThrough} onChange={(event) => setForm((current) => ({ ...current, sentThrough: event.target.value }))} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="font-semibold">Who should receive it</h3>
          <p className="mt-1 text-sm text-muted-foreground">Choose one or more values within a dimension to match any of them. Different dimensions are combined together.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name-id-search">Name or ID contains</Label>
            <Input id="name-id-search" value={form.population.nameIdSearch} maxLength={200} onChange={(event) => setPopulation("nameIdSearch", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-search">Contact contains</Label>
            <Input id="contact-search" value={form.population.contactSearch} maxLength={200} onChange={(event) => setPopulation("contactSearch", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="employer">Employer</Label>
            <Select value={form.population.employerId || "all"} onValueChange={(value) => setPopulation("employerId", value === "all" ? "" : value)}>
              <SelectTrigger id="employer"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All employers</SelectItem>{options.employers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="employer-type">Employer type</Label>
            <Select value={form.population.employerTypeId || "all"} onValueChange={(value) => setPopulation("employerTypeId", value === "all" ? "" : value)}>
              <SelectTrigger id="employer-type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All employer types</SelectItem>{options.employerTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <MultiChoice label="Member statuses" options={[{ id: "none", name: "No member status" }, ...options.memberStatuses]} value={form.population.memberStatusIds} onChange={(memberStatusIds) => setPopulation("memberStatusIds", memberStatusIds)} />
          <MultiChoice label="Benefits" options={options.benefits} value={form.population.benefitIds} onChange={(benefitIds) => setPopulation("benefitIds", benefitIds)} disabled={!options.benefitsEnabled} help={!options.benefitsEnabled ? "Benefits are currently unavailable for editing." : "A worker can match any selected benefit."} />
          <fieldset className="space-y-3 rounded-md border border-border bg-muted/20 p-3" disabled={form.population.benefitIds.length === 0}>
            <legend className="px-1 text-sm font-medium">Benefit history period</legend>
            {form.population.benefitIds.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">Select at least one benefit to apply a history period. With no benefits selected, benefits do not restrict the population.</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="benefit-period-mode">Include benefit history</Label>
                  <select
                    id="benefit-period-mode"
                    value={benefitPeriodMode}
                    onChange={(event) => setBenefitPeriodMode(event.target.value as BenefitPeriodMode)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="current">Current benefit month</option>
                    <option value="ever">Ever through reference month</option>
                    <option value="lookback">Last N months</option>
                    <option value="range">Date range</option>
                  </select>
                </div>
                {benefitPeriodMode === "lookback" && (
                  <div className="space-y-2">
                    <Label htmlFor="benefit-lookback-months">Number of months</Label>
                    <Input id="benefit-lookback-months" type="number" min={1} max={1200} step={1} value={lookbackMonths} onChange={(event) => setLookbackMonths(event.target.value)} />
                    <p className="text-xs leading-relaxed text-muted-foreground">The last N months includes the current month plus the N−1 preceding months.</p>
                  </div>
                )}
                {benefitPeriodMode === "range" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="benefit-from">Benefit from</Label>
                      <Input id="benefit-from" type="date" value={benefitFrom} onChange={(event) => setBenefitFrom(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="benefit-through">Benefit through</Label>
                      <Input id="benefit-through" type="date" value={benefitThrough} onChange={(event) => setBenefitThrough(event.target.value)} />
                    </div>
                  </div>
                )}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Any selected benefit in any included month is enough to match. Benefit history is evaluated by monthly overlap; communication sent dates above are a separate filter.
                </p>
              </>
            )}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="bargaining-unit">Bargaining unit</Label>
            {!options.bargainingUnitsEnabled ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                <span>Bargaining units are unavailable for editing. Saved choice: {form.population.bargainingUnitId ? options.bargainingUnits.find((item) => item.id === form.population.bargainingUnitId)?.name ?? form.population.bargainingUnitId : "none"}.</span>
                {form.population.bargainingUnitId && <Button type="button" variant="ghost" size="sm" onClick={() => setPopulation("bargainingUnitId", "")}>Clear saved choice</Button>}
              </div>
            ) : (
              <Select value={form.population.bargainingUnitId || "all"} onValueChange={(value) => setPopulation("bargainingUnitId", value === "all" ? "" : value)}>
                <SelectTrigger id="bargaining-unit"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All bargaining units</SelectItem>{options.bargainingUnits.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="representative">Representative</Label>
            {!options.politicalEnabled ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                <span>Representatives are unavailable for editing. Saved choice: {form.population.representativeId ? options.representatives.find((item) => item.id === form.population.representativeId)?.name ?? form.population.representativeId : "none"}.</span>
                {form.population.representativeId && <Button type="button" variant="ghost" size="sm" onClick={() => setPopulation("representativeId", "")}>Clear saved choice</Button>}
              </div>
            ) : (
              <Select value={form.population.representativeId || "all"} onValueChange={(value) => setPopulation("representativeId", value === "all" ? "" : value)}>
                <SelectTrigger id="representative"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All representatives</SelectItem>{options.representatives.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-title">Job title</Label>
            <Input id="job-title" maxLength={200} value={form.population.jobTitle} onChange={(event) => setPopulation("jobTitle", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-status">Contact details</Label>
            <Select value={form.population.contactStatus} onValueChange={(contactStatus) => setPopulation("contactStatus", contactStatus as DefinitionForm["population"]["contactStatus"])}>
              <SelectTrigger id="contact-status"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTACT_STATUSES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-3 rounded-md border border-border px-3 py-3 text-sm sm:col-span-2">
            <Checkbox checked={form.population.hasMultipleEmployers} onCheckedChange={(checked) => setPopulation("hasMultipleEmployers", !!checked)} />
            Only workers with multiple employers
          </label>
        </div>
      </section>

      {formError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>Cancel</Button>
        <Button type="submit" disabled={isSaving || options.tags.length === 0}>{isSaving ? "Saving…" : definition ? "Save definition" : "Create definition"}</Button>
      </div>
      {options.tags.length === 0 && <p className="text-right text-xs text-muted-foreground">No communication tags are available, so this definition cannot be saved yet.</p>}
    </form>
  );
}
