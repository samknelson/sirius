import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import { GrievanceForm, type GrievanceFormValues } from "@/components/grievances/grievance-form";
import { GrievanceWorkerManager } from "@/components/grievances/grievance-worker-section";
import { GrievanceEmployerManager } from "@/components/grievances/grievance-employer-section";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function GrievanceEditContent() {
  const { grievance } = useGrievanceLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (values: GrievanceFormValues) => {
    setIsSubmitting(true);
    try {
      const isClass = values.cardinality === "class";
      await apiRequest("PATCH", `/api/grievances/${grievance.id}`, {
        complaint: values.complaint?.trim() ? values.complaint.trim() : null,
        remedy: values.remedy?.trim() ? values.remedy.trim() : null,
        classDescription: isClass && values.classDescription?.trim() ? values.classDescription.trim() : null,
        cardinality: values.cardinality,
        statusId: values.statusId,
        categoryId: values.categoryId,
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
              complaint: grievance.complaint ?? "",
              remedy: grievance.remedy ?? "",
              classDescription: grievance.classDescription ?? "",
              cardinality: grievance.cardinality,
              statusId: grievance.statusId,
              categoryId: grievance.categoryId,
            }}
            onSubmit={handleSubmit}
            submitLabel="Save Changes"
            isSubmitting={isSubmitting}
          />
        </CardContent>
      </Card>

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
