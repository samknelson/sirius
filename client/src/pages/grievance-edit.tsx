import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import { GrievanceForm, type GrievanceFormValues } from "@/components/grievances/grievance-form";
import { GrievanceWorkerManager } from "@/components/grievances/grievance-worker-section";
import { GrievanceEmployerManager } from "@/components/grievances/grievance-employer-section";
import { GrievanceLineSection } from "@/components/grievances/grievance-line-section";
import { GrievanceUserManager } from "@/components/grievances/grievance-user-section";
import { GrievanceContractSection } from "@/components/grievances/grievance-contract-section";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (values: GrievanceFormValues) => {
    setIsSubmitting(true);
    try {
      const isClass = values.cardinality === "class";
      await apiRequest("PATCH", `/api/grievances/${grievance.id}`, {
        siriusId: values.siriusId?.trim() ? values.siriusId.trim() : null,
        classDescription: isClass && values.classDescription?.trim() ? values.classDescription.trim() : null,
        cardinality: values.cardinality,
        statusId: values.statusId,
        categoryId: values.categoryId,
        ...(showBargainingUnit
          ? { bargainingUnitId: values.bargainingUnitId ? values.bargainingUnitId : null }
          : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievance.id] });
      toast({ title: "Grievance updated" });
      navigate(`/grievance/${grievance.id}`);
    } catch (error: any) {
      toast({
        title: "Failed to update grievance",
        description: error?.message ?? "Please try again.",
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
              statusId: grievance.statusId,
              categoryId: grievance.categoryId,
              bargainingUnitId: grievance.bargainingUnitId ?? "",
            }}
            onSubmit={handleSubmit}
            submitLabel="Save Changes"
            isSubmitting={isSubmitting}
            canEditSiriusId={isAdmin}
          />
        </CardContent>
      </Card>

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

      {showContract && <GrievanceContractSection grievanceId={grievance.id} />}
    </div>
  );
}

export default function GrievanceEdit() {
  return (
    <GrievanceLayout activeTab="edit">
      <GrievanceEditContent />
    </GrievanceLayout>
  );
}
