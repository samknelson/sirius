import { FileText } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { GrievanceForm, type GrievanceFormValues } from "@/components/grievances/grievance-form";
import {
  GrievanceWorkerSection,
  type SectionWorker,
  type WorkerSearchHit,
} from "@/components/grievances/grievance-worker-section";
import { GrievanceEmployerSection } from "@/components/grievances/grievance-employer-section";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { type GrievanceCardinality } from "@shared/schema";

export default function GrievancesAdd() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardinality, setCardinality] = useState<GrievanceCardinality>("individual");
  const [staged, setStaged] = useState<SectionWorker[]>([]);
  const [stagedEmployerId, setStagedEmployerId] = useState<string | null>(null);

  const tabs = [
    { id: "list", label: "List", href: "/grievances" },
    { id: "add", label: "Add", href: "/grievances/add" },
  ];

  // Keep the staged worker list consistent with the chosen cardinality so the
  // create flush never violates the server-side rules.
  const reconcile = (next: GrievanceCardinality) => {
    setStaged((prev) => {
      if (next === "class") return [];
      if (next === "individual") return prev.slice(0, 1).map((w) => ({ ...w, primary: true }));
      if (next === "multiple") return prev.map((w) => ({ ...w, primary: false }));
      let leadSeen = false;
      return prev.map((w) => {
        if (w.primary && !leadSeen) {
          leadSeen = true;
          return w;
        }
        return { ...w, primary: false };
      });
    });
  };

  const handleCardinalityChange = (next: GrievanceCardinality) => {
    setCardinality(next);
    reconcile(next);
  };

  const addStaged = (worker: WorkerSearchHit) => {
    setStaged((prev) => {
      if (prev.some((w) => w.workerId === worker.id)) return prev;
      if (cardinality === "individual" && prev.length >= 1) return prev;
      return [
        ...prev,
        {
          workerId: worker.id,
          siriusId: worker.siriusId,
          displayName: worker.displayName,
          primary: cardinality === "individual",
        },
      ];
    });
  };

  const removeStaged = (workerId: string) => {
    setStaged((prev) => prev.filter((w) => w.workerId !== workerId));
  };

  const setStagedPrimary = (workerId: string, primary: boolean) => {
    setStaged((prev) =>
      prev.map((w) => {
        if (w.workerId === workerId) return { ...w, primary };
        return primary ? { ...w, primary: false } : w;
      }),
    );
  };

  const handleSubmit = async (values: GrievanceFormValues) => {
    setIsSubmitting(true);
    try {
      const isClass = values.cardinality === "class";
      const created = await apiRequest("POST", "/api/grievances", {
        complaint: values.complaint?.trim() ? values.complaint.trim() : null,
        remedy: values.remedy?.trim() ? values.remedy.trim() : null,
        classDescription: isClass && values.classDescription?.trim() ? values.classDescription.trim() : null,
        cardinality: values.cardinality,
        statusId: values.statusId,
        categoryId: values.categoryId,
      });

      // Flush staged workers. The grievance already exists, so a partial
      // failure is surfaced without losing the created record.
      let failed = 0;
      if (!isClass) {
        for (const worker of staged) {
          try {
            await apiRequest("POST", `/api/grievances/${created.id}/workers`, {
              workerId: worker.workerId,
            });
          } catch {
            failed++;
          }
        }
        if (values.cardinality === "multiple-with-lead") {
          const lead = staged.find((w) => w.primary);
          if (lead) {
            try {
              await apiRequest("PATCH", `/api/grievances/${created.id}/workers/${lead.workerId}`, {
                primary: true,
              });
            } catch {
              failed++;
            }
          }
        }
      }

      if (stagedEmployerId) {
        try {
          await apiRequest("POST", `/api/grievances/${created.id}/employers`, {
            employerId: stagedEmployerId,
          });
        } catch {
          failed++;
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
      if (failed > 0) {
        toast({
          title: "Grievance created with issues",
          description: `${failed} change(s) could not be saved. You can fix them on the grievance page.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Grievance created" });
      }
      navigate(`/grievance/${created.id}`);
    } catch (error: any) {
      toast({
        title: "Failed to create grievance",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="Add Grievance"
        icon={<FileText className="text-primary-foreground" size={16} />}
        backLink={{ href: "/grievances", label: "Back to Grievances" }}
      />

      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant={location === tab.href ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-grievances-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="pt-6 max-w-2xl">
            <GrievanceForm
              onSubmit={handleSubmit}
              submitLabel="Create Grievance"
              isSubmitting={isSubmitting}
              onCardinalityChange={handleCardinalityChange}
              renderWorkerSection={(c) => (
                <GrievanceWorkerSection
                  cardinality={c}
                  workers={staged}
                  onAdd={addStaged}
                  onRemove={removeStaged}
                  onSetPrimary={setStagedPrimary}
                  busy={isSubmitting}
                />
              )}
              renderEmployerSection={() => (
                <GrievanceEmployerSection
                  employerId={stagedEmployerId}
                  onChange={setStagedEmployerId}
                  busy={isSubmitting}
                />
              )}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
