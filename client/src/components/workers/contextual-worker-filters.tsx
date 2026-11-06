import { useId, useState, type ReactNode } from "react";
import type { Employer } from "@shared/schema";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkerFilters } from "@/components/workers/workers-table";

interface StatusOption {
  id: string;
  name: string;
  code?: string | null;
  employed?: boolean;
  industryId?: string | null;
  data?: { isActive?: boolean | string; color?: string } | null;
}

interface FilterChip {
  key: keyof WorkerFilters | "contactSearch" | "nameIdSearch";
  label: string;
}

interface ContextualWorkerFiltersProps {
  filters: WorkerFilters;
  appliedFilters: WorkerFilters;
  onChange: (filters: WorkerFilters) => void;
  employers: Employer[];
  employerTypes: { id: string; name: string }[];
  bargainingUnits: { id: string; siriusId?: string; name: string; data?: { icon?: string } | null }[];
  benefits: { id: string; name: string; isActive?: boolean }[];
  memberStatuses: StatusOption[];
  employmentStatuses: StatusOption[];
  workStatuses: StatusOption[];
  industries: { id: string; name: string }[];
  politicalOfficials: { id: string; name: string; officeName: string; level?: string }[];
  fieldReps: { id: string; name: string; detail?: string }[];
  fieldRepsLoading: boolean;
  fieldRepsError: boolean;
  onRetryFieldReps: () => void;
  bargainingUnitsEnabled: boolean;
  cardcheckEnabled: boolean;
  stewardEnabled: boolean;
  stewardLabel: string;
  btuEnabled: boolean;
  benefitsEnabled: boolean;
  politicalEnabled: boolean;
  enableBenefitRoleFilters: boolean;
  contactQuery: string;
  appliedContact: string;
  appliedNameId: string;
  openSections?: string[];
  onOpenSectionsChange?: (values: string[]) => void;
  onContactChange: (value: string) => void;
  onApply: () => void;
  onRemoveApplied: (key: FilterChip["key"]) => void;
  onClear: () => void;
}

const CONTACT_STATUS: Record<string, string> = {
  has_email: "Has email",
  missing_email: "Missing email",
  has_phone: "Has phone",
  missing_phone: "Missing phone",
  has_address: "Has address",
  missing_address: "Missing address",
  complete: "Complete contact information",
  incomplete: "Incomplete contact information",
};

export function ContextualWorkerFilters(props: ContextualWorkerFiltersProps) {
  const {
    filters, appliedFilters, onChange, employers, employerTypes, bargainingUnits, benefits,
    memberStatuses, employmentStatuses, workStatuses, industries, politicalOfficials,
    fieldReps,
    fieldRepsLoading, fieldRepsError, onRetryFieldReps,
    bargainingUnitsEnabled, cardcheckEnabled, benefitsEnabled, politicalEnabled,
    stewardEnabled, stewardLabel, btuEnabled,
    enableBenefitRoleFilters,
    contactQuery, appliedContact, onContactChange, onApply, onRemoveApplied, onClear,
    appliedNameId,
    openSections: controlledOpenSections,
    onOpenSectionsChange,
  } = props;
  const [localOpenSections, setLocalOpenSections] = useState(["contact"]);
  const openSections = controlledOpenSections ?? localOpenSections;
  const setOpenSections = onOpenSectionsChange ?? setLocalOpenSections;
  const [showWorkStatusDetails, setShowWorkStatusDetails] = useState(
    Boolean(filters.workStatusIds?.length),
  );
  const idPrefix = useId();
  const change = <K extends keyof WorkerFilters>(key: K, value: WorkerFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const mkOptions = (
    values: { id: string; name: string; group?: string; detail?: string; labelClassName?: string }[],
    chosen: string[],
    sentinel?: { value: string; label: string; group?: string },
  ): MultiSelectOption[] => {
    const options: MultiSelectOption[] = [
      ...(sentinel ? [{ ...sentinel }] : []),
      ...values.map(item => ({
        value: item.id,
        label: item.name,
        group: item.group,
        detail: item.detail,
        labelClassName: item.labelClassName,
      })),
    ];
    const known = new Set(options.map(option => option.value));
    for (const unknown of chosen) {
      if (!known.has(unknown)) options.push({ value: unknown, label: `Unknown (${unknown})` });
    }
    return options;
  };
  const field = (label: string, control: ReactNode, help?: ReactNode) => (
    <div className="min-w-0 space-y-1.5">
      <div className="text-sm font-medium">{label}</div>
      {control}
      {help && <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>}
    </div>
  );
  const selectedEmployerIds = filters.employerIds?.length
    ? filters.employerIds
    : filters.employerId !== "all" ? [filters.employerId] : [];
  const appliedEmployerIds = appliedFilters.employerIds?.length
    ? appliedFilters.employerIds
    : appliedFilters.employerId !== "all" ? [appliedFilters.employerId] : [];
  const activeEmployerNames = selectedEmployerIds.map(id =>
    employers.find(item => item.id === id)?.name ?? `Unknown (${id})`,
  );
  const appliedEmployerNames = appliedEmployerIds.map(id =>
    employers.find(item => item.id === id)?.name ?? `Unknown (${id})`,
  );
  const employmentMode = filters.employmentMode ??
    (selectedEmployerIds.length ? "ever" : undefined);
  const appliedEmploymentMode = appliedFilters.employmentMode ??
    (appliedEmployerIds.length ? "ever" : undefined);
  const employmentOptions = employmentStatuses.map(status => ({
    id: status.id,
    name: status.name,
    group: status.employed === true ? "Employed" : status.employed === false ? "Not employed" : "Employment flag not set",
  }));
  const memberOptions = [
    { id: "none", name: "No membership status", group: "No status" },
    ...memberStatuses.map(status => ({
      id: status.id,
      name: status.name,
      group: status.industryId
        ? industries.find(industry => industry.id === status.industryId)?.name ?? "Unknown industry"
        : "No industry",
    })),
  ];
  const workOptions = [
    { id: "none", name: "No current work status", group: "No status" },
    ...workStatuses.map(status => ({
      id: status.id,
      name: status.name,
      group: status.data?.isActive === true || status.data?.isActive === "true" ? "Active" : "Inactive",
    })),
  ];
  const selectedMemberLabels = (appliedFilters.memberStatusIds ?? []).map(id =>
    id === "none" ? "No membership status" : memberStatuses.find(status => status.id === id)?.name ?? `Unknown (${id})`,
  );
  const selectedWorkLabels = (appliedFilters.workStatusIds ?? []).map(id =>
    id === "none" ? "No current work status" : workStatuses.find(status => status.id === id)?.name ?? `Unknown (${id})`,
  );
  const chips: FilterChip[] = [];
  if (appliedNameId) chips.push({ key: "nameIdSearch", label: `Name / ID: ${appliedNameId}` });
  if (appliedContact) chips.push({ key: "contactSearch", label: `Contact: ${appliedContact}` });
  if (appliedFilters.contactStatus !== "all") chips.push({ key: "contactStatus", label: CONTACT_STATUS[appliedFilters.contactStatus] ?? "Contact status" });
  if (appliedEmployerIds.length) {
    chips.push({ key: "employerIds", label: `Employer: ${appliedEmployerNames.join(", ")}` });
    if (appliedEmploymentMode && appliedEmploymentMode !== "ever") {
      chips.push({ key: "employmentMode", label: appliedEmploymentMode === "current" ? "Currently employed" : "Specific employment statuses" });
    }
    if (appliedEmploymentMode === "custom" && appliedFilters.employmentStatusIds?.length) {
      const names = appliedFilters.employmentStatusIds.map(id => employmentOptions.find(status => status.id === id)?.name ?? `Unknown (${id})`);
      chips.push({ key: "employmentStatusIds", label: `Employment status: ${names.join(", ")}` });
    } else if (appliedEmploymentMode === "ever") {
      chips.push({ key: "employmentMode", label: "Ever worked there" });
    }
  }
  if (appliedFilters.employerTypeId !== "all") chips.push({ key: "employerTypeId", label: `Employer type: ${employerTypes.find(type => type.id === appliedFilters.employerTypeId)?.name ?? "Selected"}` });
  if (appliedFilters.jobTitle) chips.push({ key: "jobTitle", label: `Job title: ${appliedFilters.jobTitle}` });
  if (appliedFilters.hasMultipleEmployers) chips.push({ key: "hasMultipleEmployers", label: "Multiple employers" });
  if (appliedFilters.memberStatusIds?.length) chips.push({ key: "memberStatusIds", label: `Membership: ${selectedMemberLabels.join(", ")}` });
  if (appliedFilters.bargainingUnitIds?.length) chips.push({ key: "bargainingUnitIds", label: `${appliedFilters.bargainingUnitIds.length} bargaining unit${appliedFilters.bargainingUnitIds.length === 1 ? "" : "s"}` });
  if (appliedFilters.isSteward && appliedFilters.isSteward !== "all") chips.push({ key: "isSteward", label: appliedFilters.isSteward === "yes" ? `Assigned ${stewardLabel}` : `No ${stewardLabel} assignment` });
  if (appliedFilters.fieldRepIds?.length) chips.push({ key: "fieldRepIds", label: `${appliedFilters.fieldRepIds.length} field representative${appliedFilters.fieldRepIds.length === 1 ? "" : "s"}` });
  if (appliedFilters.workStatusActive && appliedFilters.workStatusActive !== "all") chips.push({ key: "workStatusActive", label: appliedFilters.workStatusActive === "yes" ? "Active work status" : "Inactive work status" });
  if (appliedFilters.workStatusIds?.length) chips.push({ key: "workStatusIds", label: `Work status: ${selectedWorkLabels.join(", ")}` });
  const appliedBenefitIds = appliedFilters.benefitIds?.length
    ? appliedFilters.benefitIds
    : appliedFilters.benefitId !== "all" ? [appliedFilters.benefitId] : [];
  if (benefitsEnabled && appliedBenefitIds.length) {
    const names = appliedBenefitIds.map(id => benefits.find(item => item.id === id)?.name ?? `Unknown (${id})`);
    chips.push({ key: "benefitIds", label: `Benefits: ${names.join(", ")}` });
  }
  if (politicalEnabled && appliedFilters.representativeIds?.length) chips.push({ key: "representativeIds", label: `${appliedFilters.representativeIds.length} elected representative${appliedFilters.representativeIds.length === 1 ? "" : "s"}` });
  if (appliedFilters.isSubscriber === "yes" || appliedFilters.subscriberSinceFrom || appliedFilters.subscriberSinceThrough) {
    chips.push({ key: "isSubscriber", label: `Subscriber${appliedFilters.subscriberSinceFrom || appliedFilters.subscriberSinceThrough ? " · date range" : ""}` });
  }
  if (appliedFilters.isDependent === "yes" || appliedFilters.dependentSinceFrom || appliedFilters.dependentSinceThrough) {
    chips.push({ key: "isDependent", label: `Dependent${appliedFilters.dependentSinceFrom || appliedFilters.dependentSinceThrough ? " · date range" : ""}` });
  }

  const header = (title: string, summary: string, active: boolean) => (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
      <span className="font-semibold">{title}</span>
      <span className="flex min-w-0 items-center gap-2">
        {active && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Draft filter selected" />}
        <span className="max-w-[min(58vw,34rem)] truncate text-xs font-normal text-muted-foreground" title={summary}>{summary}</span>
      </span>
    </span>
  );

  const membershipVisible = bargainingUnitsEnabled || cardcheckEnabled || stewardEnabled || btuEnabled;
  return (
    <section className="rounded-md border bg-card" data-testid="contextual-worker-filters" aria-label="Worker filters">
      <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="divide-y">
        <AccordionItem value="contact" className="border-0 px-4">
          <AccordionTrigger className="py-3 hover:no-underline">
            {header("Contact", filters.contactStatus !== "all" || contactQuery ? `${CONTACT_STATUS[filters.contactStatus] ?? ""}${contactQuery ? ` · ${contactQuery}` : ""}` || "Any contact details" : "Any contact details", filters.contactStatus !== "all" || Boolean(contactQuery))}
          </AccordionTrigger>
          <AccordionContent className="pt-1">
            <div className="grid gap-4 pb-2 md:grid-cols-2">
              {field("Email, phone, or address", <Input aria-label="Search workers by email, phone, or address"
                placeholder="Search contact details..." value={contactQuery} onChange={event => onContactChange(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter") onApply(); }} data-testid="input-search-contact" />)}
              {field("Contact information", <Select value={filters.contactStatus || "all"} onValueChange={value => change("contactStatus", value)}>
                <SelectTrigger aria-label="Contact information" data-testid="select-contact-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any contact information</SelectItem>
                  {Object.entries(CONTACT_STATUS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>, "Contact details are evaluated independently of employment.")}
            </div>
          </AccordionContent>
        </AccordionItem>
        {membershipVisible && (
          <AccordionItem value="membership" className="border-0 px-4">
            <AccordionTrigger className="py-3 hover:no-underline">
              {header("Membership", [
                bargainingUnitsEnabled && filters.bargainingUnitIds?.length ? `${filters.bargainingUnitIds.length} units` : "",
                cardcheckEnabled && filters.memberStatusIds?.length ? `${filters.memberStatusIds.length} statuses` : "",
                stewardEnabled && filters.isSteward && filters.isSteward !== "all" ? `${filters.isSteward === "yes" ? "Assigned" : "Unassigned"} ${stewardLabel}` : "",
                btuEnabled && filters.fieldRepIds?.length ? `${filters.fieldRepIds.length} field reps` : "",
              ].filter(Boolean).join(" · ") || "All membership and units", Boolean(
                filters.memberStatusIds?.length || filters.bargainingUnitIds?.length ||
                (filters.isSteward && filters.isSteward !== "all") || filters.fieldRepIds?.length,
              ))}
            </AccordionTrigger>
            <AccordionContent className="pt-1">
              <div className="grid gap-4 pb-2 md:grid-cols-2">
                {bargainingUnitsEnabled && field("Bargaining units", <MultiSelect aria-label="Bargaining units"
                  value={filters.bargainingUnitIds ?? []} onChange={value => change("bargainingUnitIds", value)}
                options={mkOptions(bargainingUnits.map(unit => ({ id: unit.id, name: unit.name })), filters.bargainingUnitIds ?? [])}
                  placeholder="All bargaining units" searchPlaceholder="Search bargaining units..." selectionActions
                  testId="select-bargaining-unit-filter" />)}
                {cardcheckEnabled && field("Membership statuses", <MultiSelect aria-label="Membership statuses"
                  value={filters.memberStatusIds ?? []} onChange={value => change("memberStatusIds", value)}
                  options={mkOptions(memberOptions, filters.memberStatusIds ?? [])}
                  placeholder="All membership statuses" searchPlaceholder="Search statuses..." selectionActions
                  testId="select-member-status-filter" />)}
                {stewardEnabled && field("Steward assignment", <Select value={filters.isSteward || "all"}
                  onValueChange={value => change("isSteward", value as WorkerFilters["isSteward"])}>
                  <SelectTrigger aria-label="Steward assignment" data-testid="select-steward-filter"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All workers</SelectItem><SelectItem value="yes">Has an assigned {stewardLabel.toLowerCase()} role</SelectItem><SelectItem value="no">No {stewardLabel.toLowerCase()} assignment</SelectItem></SelectContent>
                </Select>)}
                {btuEnabled && field("Field representative", <MultiSelect aria-label="Field representative"
                  value={filters.fieldRepIds ?? []} onChange={value => change("fieldRepIds", value)}
                  options={mkOptions(fieldReps, filters.fieldRepIds ?? [])}
                  placeholder="All field representatives" searchPlaceholder="Search field reps..." selectionActions
                  disabled={fieldRepsLoading || fieldRepsError || fieldReps.length === 0}
                  testId="select-field-rep-filter" />,
                  fieldRepsLoading ? "Loading territory representatives…" : fieldReps.length ? undefined : "No territory representatives are available.")}
                {btuEnabled && fieldRepsError && <p className="text-xs text-destructive" role="alert">
                  Field representative assignments could not be loaded.{" "}
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onRetryFieldReps}>Retry</Button>
                </p>}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
        <AccordionItem value="employment" className="border-0 px-4">
          <AccordionTrigger className="py-3 hover:no-underline">
            {header("Employment", activeEmployerNames.length
              ? `${activeEmployerNames.join(", ")} · ${employmentMode === "current" ? "Currently employed" : employmentMode === "custom" ? "Specific statuses" : "Ever worked there"}`
              : filters.jobTitle ? `Title: ${filters.jobTitle}` : "All employers", Boolean(selectedEmployerIds.length || filters.jobTitle || filters.hasMultipleEmployers))}
          </AccordionTrigger>
          <AccordionContent className="pt-1">
            <div className="grid gap-4 pb-2 md:grid-cols-2 xl:grid-cols-3">
              {field("Employers", <MultiSelect aria-label="Employers" value={selectedEmployerIds}
                onChange={value => {
                  const hadEmployers = selectedEmployerIds.length > 0;
                  if (!hadEmployers && value.length) {
                    onChange({ ...filters, employerIds: value, employmentMode: "current", employmentStatusIds: [] });
                  } else if (!value.length) {
                    onChange({ ...filters, employerIds: [], employerId: "all", employmentMode: undefined, employmentStatusIds: [] });
                  } else {
                    onChange({ ...filters, employerIds: value, employerId: "all", employmentMode: filters.employmentMode ?? "ever" });
                  }
                }}
                options={mkOptions(employers.filter(item => item.isActive).slice().sort((a, b) => a.name.localeCompare(b.name))
                  .map(item => ({ id: item.id, name: item.name, group: employerTypes.find(type => type.id === item.typeId)?.name ?? "Other employers" })),
                  selectedEmployerIds)}
                placeholder="All employers" searchPlaceholder="Search employers..." selectionActions
                testId="select-employer-filter" testIdPrefix="select-employer" />)}
              {field("Employer type", <Select value={filters.employerTypeId || "all"} onValueChange={value => change("employerTypeId", value)}>
                <SelectTrigger aria-label="Employer type" data-testid="select-employer-type-filter"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All employer types</SelectItem>{employerTypes.map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent>
              </Select>)}
              {field("Job title", <Input aria-label="Job title" placeholder="Any job title" value={filters.jobTitle ?? ""}
                onChange={event => change("jobTitle", event.target.value)} onKeyDown={event => { if (event.key === "Enter") onApply(); }}
                data-testid="input-job-title-filter" />)}
              <div className="flex min-h-10 items-center gap-2 rounded-md border px-3">
                <Checkbox id={`${idPrefix}-multiple-employers`} checked={filters.hasMultipleEmployers ?? false}
                  onCheckedChange={checked => change("hasMultipleEmployers", checked === true)} data-testid="checkbox-multiple-employers" />
                <label htmlFor={`${idPrefix}-multiple-employers`} className="cursor-pointer text-sm">Works for multiple employers</label>
              </div>
            </div>
            {selectedEmployerIds.length ? (
              <div className="mt-2 border-t pt-3">
                <p className="mb-2 text-sm font-semibold">Employment at these employers</p>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Employment timeframe">
                  {[
                    { value: "current", label: "Currently employed, including leave", description: "Includes leave statuses configured as employed." },
                    { value: "ever", label: "Ever worked there", description: "Any recorded employment at a selected employer." },
                    { value: "custom", label: "Specific statuses", description: "Use the latest employment record at a selected employer." },
                  ].map(option => (
                    <label key={option.value} className={`flex cursor-pointer gap-2 rounded-md border p-3 ${employmentMode === option.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                      <input type="radio" name={`${idPrefix}-employment-mode`} aria-label={option.label} value={option.value}
                        checked={employmentMode === option.value} onChange={() => change("employmentMode", option.value as WorkerFilters["employmentMode"])}
                        className="mt-1 accent-primary" />
                      <span><span className="block text-sm font-medium">{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.description}</span></span>
                    </label>
                  ))}
                </div>
                {employmentMode === "custom" && field("Employment statuses", <MultiSelect aria-label="Employment statuses"
                  value={filters.employmentStatusIds ?? []} onChange={value => change("employmentStatusIds", value)}
                  options={mkOptions(employmentOptions, filters.employmentStatusIds ?? [])}
                  placeholder="Any latest status" searchPlaceholder="Search employment statuses..." selectionActions
                  testId="select-employment-status-filter" />, "The status is checked against the latest employment record at the selected employer.")}
              </div>
            ) : <p className="text-xs text-muted-foreground">Choose one or more employers to filter current, former, or specific employment records.</p>}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="work-status" className="border-0 px-4">
          <AccordionTrigger className="py-3 hover:no-underline">
            {header("Work Status", [
              filters.workStatusActive === "yes" ? "Active" : filters.workStatusActive === "no" ? "Inactive" : "",
              filters.workStatusIds?.length ? `${filters.workStatusIds.length} statuses` : "",
            ].filter(Boolean).join(" · ") || "All worker activity", Boolean((filters.workStatusIds?.length ?? 0) || (filters.workStatusActive && filters.workStatusActive !== "all")))}
          </AccordionTrigger>
          <AccordionContent className="pt-1">
            <div className="grid gap-4 pb-2 md:grid-cols-2">
              {field("Current work activity", <Select value={filters.workStatusActive || "all"}
                onValueChange={value => change("workStatusActive", value as WorkerFilters["workStatusActive"])}>
                <SelectTrigger aria-label="Current work activity" data-testid="select-work-status-active-filter"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All activity</SelectItem><SelectItem value="yes">Active</SelectItem><SelectItem value="no">Inactive</SelectItem></SelectContent>
              </Select>, "Worker-wide status, independent of employer employment history.")}
              <div>
                <Button type="button" variant="outline" size="sm" aria-expanded={showWorkStatusDetails}
                  onClick={() => setShowWorkStatusDetails(value => !value)} data-testid="button-toggle-work-status-details">
                  {showWorkStatusDetails ? "Hide status specifics" : "Choose named statuses"}
                  {!!filters.workStatusIds?.length && <Badge variant="secondary" className="ml-2">{filters.workStatusIds.length}</Badge>}
                </Button>
                {showWorkStatusDetails && <div className="mt-3">{field("Named current work statuses", <MultiSelect aria-label="Named current work statuses"
                  value={filters.workStatusIds ?? []} onChange={value => change("workStatusIds", value)}
                  options={mkOptions(workOptions, filters.workStatusIds ?? [])}
                  placeholder="Any work status" searchPlaceholder="Search work statuses..." selectionActions
                  testId="select-work-status-filter" />, "Activity and named status are combined as AND conditions.")}</div>}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
        {benefitsEnabled && (
          <AccordionItem value="benefits" className="border-0 px-4">
            <AccordionTrigger className="py-3 hover:no-underline">
              {header("Benefits", (filters.benefitIds?.length ?? 0) ? `${filters.benefitIds?.length} selected` : filters.benefitId !== "all" ? benefits.find(item => item.id === filters.benefitId)?.name ?? "Benefit selected" : "All benefits", Boolean(filters.benefitIds?.length || filters.benefitId !== "all"))}
            </AccordionTrigger>
            <AccordionContent className="pt-1">
              <div className="grid gap-4 pb-2 md:grid-cols-2">
                {field("Benefits", <MultiSelect aria-label="Benefits"
                  value={filters.benefitIds?.length ? filters.benefitIds : filters.benefitId !== "all" ? [filters.benefitId] : []}
                  onChange={value => onChange({ ...filters, benefitId: "all", benefitIds: value })}
                  options={mkOptions(benefits.filter(item => item.isActive).slice().sort((a, b) => a.name.localeCompare(b.name))
                    .map(item => ({ id: item.id, name: item.name })), filters.benefitIds ?? [])}
                  placeholder="All benefits" searchPlaceholder="Search benefits..." selectionActions
                  testId="select-benefit-filter" />)}
                {enableBenefitRoleFilters && (
                  <div className="space-y-3 md:col-span-2">
                    {(["subscriber", "dependent"] as const).map(role => {
                      const subscriber = role === "subscriber";
                      const enabled = subscriber
                        ? filters.isSubscriber === "yes" || Boolean(filters.subscriberSinceFrom || filters.subscriberSinceThrough)
                        : filters.isDependent === "yes" || Boolean(filters.dependentSinceFrom || filters.dependentSinceThrough);
                      const prefix = subscriber ? "subscriber" : "dependent";
                      return (
                        <div key={role} className="flex flex-wrap items-center gap-3">
                          <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                            <Checkbox checked={enabled} aria-label={subscriber ? "Subscriber" : "Dependent"}
                              data-testid={`checkbox-is-${role}-filter`}
                              onCheckedChange={checked => {
                                if (checked) change(subscriber ? "isSubscriber" : "isDependent", "yes");
                                else {
                                  const next = { ...filters };
                                  if (subscriber) {
                                    delete next.isSubscriber; delete next.subscriberSinceFrom; delete next.subscriberSinceThrough;
                                  } else {
                                    delete next.isDependent; delete next.dependentSinceFrom; delete next.dependentSinceThrough;
                                  }
                                  onChange(next);
                                }
                              }} />
                            {subscriber ? "Subscriber" : "Dependent"}
                          </label>
                          {enabled && <>
                            <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-${prefix}-from`}>Since</label>
                            <Input id={`${idPrefix}-${prefix}-from`} type="month" aria-label={`${subscriber ? "Subscriber" : "Dependent"} since from`}
                              value={filters[`${prefix}SinceFrom` as "subscriberSinceFrom" | "dependentSinceFrom"] ?? ""}
                              onChange={event => change(subscriber ? "subscriberSinceFrom" : "dependentSinceFrom", event.target.value)} className="w-36" />
                            <Input type="month" aria-label={`${subscriber ? "Subscriber" : "Dependent"} since through`}
                              value={filters[`${prefix}SinceThrough` as "subscriberSinceThrough" | "dependentSinceThrough"] ?? ""}
                              onChange={event => change(subscriber ? "subscriberSinceThrough" : "dependentSinceThrough", event.target.value)} className="w-36" />
                          </>}
                        </div>
                      );
                    })}
                    <p className="text-xs text-muted-foreground">Select a role, then Apply. Dates filter retained coverage history; leave blank for any month.</p>
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
        {politicalEnabled && (
          <AccordionItem value="political" className="border-0 px-4">
            <AccordionTrigger className="py-3 hover:no-underline">
              {header("Political", filters.representativeIds?.length ? `${filters.representativeIds.length} elected representative${filters.representativeIds.length === 1 ? "" : "s"}` : "All elected officials", Boolean(filters.representativeIds?.length))}
            </AccordionTrigger>
            <AccordionContent className="pt-1">
              {field("Elected representatives", <MultiSelect aria-label="Elected representatives"
                value={filters.representativeIds ?? []} onChange={value => change("representativeIds", value)}
                options={mkOptions(politicalOfficials.slice().sort((a, b) => a.name.localeCompare(b.name))
                  .map(item => ({ id: item.id, name: item.name, detail: item.officeName, group: item.level ?? "Other officials" })),
                  filters.representativeIds ?? [])}
                placeholder="All elected officials" searchPlaceholder="Search elected officials..." selectionActions
                testId="select-representative-filter" />)}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Applied filters" data-testid="applied-worker-filter-chips">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applied</span>
          {chips.length ? chips.map(chip => (
            <Badge key={`${chip.key}:${chip.label}`} variant="secondary" className="gap-1 font-normal">
              {chip.label}
              <button type="button" className="ml-1 rounded-sm hover:text-foreground" aria-label={`Remove ${chip.label}`}
                onClick={() => onRemoveApplied(chip.key)}>×</button>
            </Badge>
          )) : <span className="text-xs text-muted-foreground">No filters applied</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClear} data-testid="button-clear-worker-filters">Clear</Button>
          <Button type="button" size="sm" onClick={onApply} data-testid="button-apply-worker-filters">Apply</Button>
        </div>
      </div>
    </section>
  );
}
