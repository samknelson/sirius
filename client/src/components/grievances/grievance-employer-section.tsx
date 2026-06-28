import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface EmployerOption {
  id: string;
  name: string;
}

export interface SectionEmployer {
  employerId: string;
  name: string;
}

// SelectItem cannot use an empty-string value, so the "no employer" choice
// gets a sentinel that maps back to null.
const NO_EMPLOYER = "__none__";

interface GrievanceEmployerSectionProps {
  employerId: string | null;
  onChange: (employerId: string | null) => void | Promise<void>;
  busy?: boolean;
}

/**
 * Single-employer picker shared by the grievance create, edit, and details
 * surfaces. The grievance/employer mapping is many-to-many at the database
 * level, but the UX restricts each grievance to a single employer for now.
 *
 * Fully controlled: parents wire `onChange` to either local staged state
 * (create) or a live reconcile against the persisted grievance (edit /
 * details).
 */
export function GrievanceEmployerSection({
  employerId,
  onChange,
  busy,
}: GrievanceEmployerSectionProps) {
  const { data: employers = [] } = useQuery<EmployerOption[]>({
    queryKey: ["/api/employers"],
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employer</CardTitle>
      </CardHeader>
      <CardContent>
        <Select
          value={employerId ?? NO_EMPLOYER}
          onValueChange={(value) => onChange(value === NO_EMPLOYER ? null : value)}
          disabled={busy}
        >
          <SelectTrigger data-testid="select-grievance-employer">
            <SelectValue placeholder="Select an employer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_EMPLOYER} data-testid="option-employer-none">
              No employer
            </SelectItem>
            {employers.map((e) => (
              <SelectItem key={e.id} value={e.id} data-testid={`option-employer-${e.id}`}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}

interface GrievanceEmployerManagerProps {
  grievanceId: string;
  employers: SectionEmployer[];
}

/**
 * Live (edit / details) employer manager. Reconciles the selection to a single
 * employer using the existing per-grievance add/remove endpoints, each backed
 * by an atomic single-row storage op: every currently linked employer is
 * removed, then the selected one (if any) is added.
 */
export function GrievanceEmployerManager({
  grievanceId,
  employers,
}: GrievanceEmployerManagerProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const current = employers[0]?.employerId ?? null;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievanceId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
  };

  const onChange = async (next: string | null) => {
    if (next === current && employers.length <= 1) return;
    setBusy(true);
    try {
      for (const e of employers) {
        await apiRequest("DELETE", `/api/grievances/${grievanceId}/employers/${e.employerId}`);
      }
      if (next) {
        await apiRequest("POST", `/api/grievances/${grievanceId}/employers`, {
          employerId: next,
        });
      }
      await refresh();
      toast({ title: next ? "Employer updated" : "Employer removed" });
    } catch (error: any) {
      toast({
        title: "Failed to update employer",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return <GrievanceEmployerSection employerId={current} onChange={onChange} busy={busy} />;
}
