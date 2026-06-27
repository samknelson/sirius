import { FileText } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { GrievanceForm, type GrievanceFormValues } from "@/components/grievances/grievance-form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function GrievancesAdd() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tabs = [
    { id: "list", label: "List", href: "/grievances" },
    { id: "add", label: "Add", href: "/grievances/add" },
  ];

  const handleSubmit = async (values: GrievanceFormValues) => {
    setIsSubmitting(true);
    try {
      const created = await apiRequest("POST", "/api/grievances", {
        complaint: values.complaint?.trim() ? values.complaint.trim() : null,
        remedy: values.remedy?.trim() ? values.remedy.trim() : null,
        statusId: values.statusId,
        categoryId: values.categoryId,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
      toast({ title: "Grievance created" });
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
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
