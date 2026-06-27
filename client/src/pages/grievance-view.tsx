import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GrievanceLayout,
  useGrievanceLayout,
  type GrievanceWithDetails,
} from "@/components/layouts/GrievanceLayout";
import { GRIEVANCE_CARDINALITY_LABELS } from "@/components/grievances/grievance-form";
import { GrievanceWorkerManager } from "@/components/grievances/grievance-worker-section";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EmployerOption {
  id: string;
  name: string;
}

function EmployerManager({ grievance }: { grievance: GrievanceWithDetails }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: employers = [] } = useQuery<EmployerOption[]>({
    queryKey: ["/api/employers"],
  });

  const linkedIds = new Set(grievance.employers.map((e) => e.employerId));
  const available = employers.filter((e) => !linkedIds.has(e.id));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievance.id] });
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
  };

  const addEmployer = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await apiRequest("POST", `/api/grievances/${grievance.id}/employers`, {
        employerId: selected,
      });
      await refresh();
      setSelected("");
      toast({ title: "Employer linked" });
    } catch (error: any) {
      toast({
        title: "Failed to link employer",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const removeEmployer = async (employerId: string) => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/grievances/${grievance.id}/employers/${employerId}`);
      await refresh();
      toast({ title: "Employer unlinked" });
    } catch (error: any) {
      toast({
        title: "Failed to unlink employer",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="flex-1" data-testid="select-employer">
              <SelectValue placeholder="Select an employer to link" />
            </SelectTrigger>
            <SelectContent>
              {available.map((e) => (
                <SelectItem key={e.id} value={e.id} data-testid={`option-employer-${e.id}`}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={addEmployer}
            disabled={!selected || busy}
            data-testid="button-add-employer"
          >
            Add
          </Button>
        </div>

        {grievance.employers.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-no-employers">
            No employers linked.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {grievance.employers.map((e) => (
              <Badge
                key={e.employerId}
                variant="secondary"
                className="flex items-center gap-1"
                data-testid={`badge-employer-${e.employerId}`}
              >
                <Link href={`/employers/${e.employerId}`} className="hover:underline">
                  {e.name}
                </Link>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeEmployer(e.employerId)}
                  className="ml-1 disabled:opacity-50"
                  data-testid={`button-remove-employer-${e.employerId}`}
                >
                  <X size={12} />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GrievanceDetailsContent() {
  const { grievance } = useGrievanceLayout();

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Category</label>
                <p className="text-foreground" data-testid="text-grievance-category">
                  {grievance.categoryName || "—"}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <div>
                  <Badge variant="secondary" data-testid="badge-grievance-status">
                    {grievance.statusName || "—"}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Cardinality</label>
                <p className="text-foreground" data-testid="text-grievance-cardinality">
                  {GRIEVANCE_CARDINALITY_LABELS[grievance.cardinality] ?? grievance.cardinality}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Record ID</label>
                <p className="text-foreground font-mono text-sm" data-testid="text-grievance-id">
                  {grievance.id}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Complaint</h3>
            <p className="text-foreground whitespace-pre-wrap" data-testid="text-grievance-complaint">
              {grievance.complaint || "—"}
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Remedy</h3>
            <p className="text-foreground whitespace-pre-wrap" data-testid="text-grievance-remedy">
              {grievance.remedy || "—"}
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Class Description</h3>
            <p
              className="text-foreground whitespace-pre-wrap"
              data-testid="text-grievance-class-description"
            >
              {grievance.classDescription || "—"}
            </p>
          </div>

          <div className="pt-4 border-t border-border">
            <div className="flex items-center space-x-3">
              <Link href="/grievances">
                <Button variant="outline" data-testid="button-back-to-list">
                  Back to List
                </Button>
              </Link>
              <Link href={`/grievance/${grievance.id}/edit`}>
                <Button data-testid="button-edit-grievance">Edit</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {grievance.cardinality !== "class" && (
        <GrievanceWorkerManager
          grievanceId={grievance.id}
          cardinality={grievance.cardinality}
          workers={grievance.workers}
        />
      )}
      <EmployerManager grievance={grievance} />
    </div>
  );
}

export default function GrievanceView() {
  return (
    <GrievanceLayout activeTab="details">
      <GrievanceDetailsContent />
    </GrievanceLayout>
  );
}
