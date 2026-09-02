import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GrievanceLayout, useGrievanceLayout, isAppealRecord, useAppealPresentation } from "@/components/layouts/GrievanceLayout";
import { GrievanceForm, type GrievanceFormValues } from "@/components/grievances/grievance-form";
import { GrievanceWorkerManager } from "@/components/grievances/grievance-worker-section";
import { GrievanceEmployerManager } from "@/components/grievances/grievance-employer-section";
import { GrievanceLineSection } from "@/components/grievances/grievance-line-section";
import { GrievanceUserManager } from "@/components/grievances/grievance-user-section";
import { GrievanceContractSection } from "@/components/grievances/grievance-contract-section";
import { GrievanceRepresentativeSection } from "@/components/grievances/grievance-representative-section";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

function GrievanceEditContent() {
  const { grievance } = useGrievanceLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { hasPermission, hasComponent } = useAuth();
  const isAdmin = hasPermission("admin");
  const showBargainingUnit = hasComponent("bargainingunits");
  const showContract = hasComponent("grievance.contract");
  // Appeals reuse the grievance record but are always individual cases; the
  // form hides the generic creation choices and labels the record an appeal.
  // Form BEHAVIOR (hidden fields, forced individual cardinality) follows the
  // record's own metadata so a legacy generic record on the BAO surface keeps
  // its cardinality/class data intact; WORDING follows the surface.
  const isAppeal = isAppealRecord(grievance);
  const appealWording = useAppealPresentation(grievance);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (values: GrievanceFormValues) => {
    setIsSubmitting(true);
    try {
      const cardinality = isAppeal ? "individual" : values.cardinality;
      const isClass = cardinality === "class";
      await apiRequest("PATCH", `/api/grievances/${grievance.id}`, {
        siriusId: values.siriusId?.trim() ? values.siriusId.trim() : null,
        classDescription: isClass && values.classDescription?.trim() ? values.classDescription.trim() : null,
        cardinality,
        categoryId: values.categoryId,
        ...(showBargainingUnit
          ? { bargainingUnitId: values.bargainingUnitId ? values.bargainingUnitId : null }
          : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievance.id] });
      toast({ title: appealWording ? "Appeal updated" : "Grievance updated" });
      navigate(`/grievance/${grievance.id}`);
    } catch (error: any) {
      toast({
        title: appealWording ? "Failed to update appeal" : "Failed to update grievance",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 max-w-2xl">
          <GrievanceForm
            defaultValues={{
              siriusId: grievance.siriusId ?? "",
              classDescription: grievance.classDescription ?? "",
              cardinality: grievance.cardinality,
              categoryId: grievance.categoryId,
              bargainingUnitId: grievance.bargainingUnitId ?? "",
            }}
            onSubmit={handleSubmit}
            submitLabel="Save Changes"
            isSubmitting={isSubmitting}
            canEditSiriusId={isAdmin}
            variant={isAppeal ? "appeal" : "grievance"}
          />
        </CardContent>
      </Card>

      <GrievanceStatusCard
        grievanceId={grievance.id}
        currentStatusId={grievance.statusId}
      />

      <GrievanceUserManager
        grievanceId={grievance.id}
        users={grievance.users}
      />

      <GrievanceLineSection
        grievanceId={grievance.id}
        noun="Complaint"
        resource="complaints"
        optionsType="grievance-complaint"
        testIdPrefix="complaint"
        lines={grievance.complaints.map((c) => ({
          id: c.id,
          optionId: c.complaintId,
          description: c.description,
          sequence: c.sequence,
          optionName: c.complaintName,
        }))}
      />

      <GrievanceLineSection
        grievanceId={grievance.id}
        noun="Remedy"
        resource="remedies"
        optionsType="grievance-remedy"
        testIdPrefix="remedy"
        lines={grievance.remedies.map((r) => ({
          id: r.id,
          optionId: r.remedyId,
          description: r.description,
          sequence: r.sequence,
          optionName: r.remedyName,
        }))}
      />

      {grievance.cardinality !== "class" && (
        <GrievanceWorkerManager
          grievanceId={grievance.id}
          cardinality={grievance.cardinality}
          workers={grievance.workers}
        />
      )}

      <GrievanceEmployerManager
        grievanceId={grievance.id}
        employers={grievance.employers}
      />

      {grievance.employers[0] && (
        <GrievanceRepresentativeSection
          grievanceId={grievance.id}
          employerId={grievance.employers[0].employerId}
          employerContactId={grievance.employerContactId}
        />
      )}

      {showContract && <GrievanceContractSection grievanceId={grievance.id} />}
    </div>
  );
}

interface StatusOption {
  id: string;
  name: string;
  isActive?: boolean;
}

/**
 * Dedicated status card with its own Save. Saving appends a new status-history
 * entry stamped "now" by the server (the current status is derived from the
 * latest-dated entry). Backdated entries are managed on the Status History tab.
 */
function GrievanceStatusCard({
  grievanceId,
  currentStatusId,
}: {
  grievanceId: string;
  currentStatusId: string | null;
}) {
  const { toast } = useToast();
  const [selectedStatusId, setSelectedStatusId] = useState<string>(currentStatusId ?? "");
  const [isSaving, setIsSaving] = useState(false);

  // After a status save, the grievance query is invalidated and refetched;
  // sync the selection with the refreshed current status so the card (and
  // its disabled Save button) reflects the newly current status instead of
  // the value captured at first render.
  useEffect(() => {
    setSelectedStatusId(currentStatusId ?? "");
  }, [currentStatusId]);

  const { data: statuses = [] } = useQuery<StatusOption[]>({
    queryKey: ["/api/options/grievance-status"],
  });

  const handleSave = async () => {
    if (!selectedStatusId) return;
    setIsSaving(true);
    try {
      await apiRequest("POST", `/api/grievances/${grievanceId}/status-history`, {
        statusId: selectedStatusId,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievanceId] });
      await queryClient.invalidateQueries({
        queryKey: ["/api/grievances", grievanceId, "status-history"],
      });
      toast({ title: "Status updated" });
    } catch (error: any) {
      toast({
        title: "Failed to update status",
        description: getApiErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Status</CardTitle>
      </CardHeader>
      <CardContent className="max-w-2xl space-y-4">
        <Select value={selectedStatusId} onValueChange={setSelectedStatusId}>
          <SelectTrigger data-testid="select-grievance-status">
            <SelectValue placeholder="Select a status" />
          </SelectTrigger>
          <SelectContent>
            {statuses
              .filter((s) => s.isActive !== false)
              .map((s) => (
                <SelectItem key={s.id} value={s.id} data-testid={`option-status-${s.id}`}>
                  {s.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Saving records a new status history entry dated now. To backdate or
          correct entries, use the Status History tab.
        </p>
        <Button
          onClick={handleSave}
          disabled={isSaving || !selectedStatusId || selectedStatusId === (currentStatusId ?? "")}
          data-testid="button-save-status"
        >
          {isSaving ? "Saving..." : "Save Status"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function GrievanceEdit() {
  return (
    <GrievanceLayout activeTab="edit">
      <GrievanceEditContent />
    </GrievanceLayout>
  );
}
