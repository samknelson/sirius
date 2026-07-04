import { Building2, Plus, ClipboardList } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { WizardLauncher } from "@/components/wizards/WizardLauncher";
import { format } from "date-fns";
import type { Wizard } from "@/lib/wizard-types";

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "default";
    case "draft": return "secondary";
    case "error": return "destructive";
    default: return "outline";
  }
}

function getStepLabel(step: string | null | undefined): string {
  if (!step) return "—";
  const labels: Record<string, string> = {
    employer_name: "Employer Name",
    attributes: "Attributes",
    contacts: "Contacts",
    worker_load: "Worker Load",
    review: "Review",
  };
  return labels[step] || step;
}

export default function EmployersOnboarding() {
  const [location, setLocation] = useLocation();

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: allWizards = [], isLoading: wizardsLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards"],
  });

  const onboardingWizards = allWizards
    .filter(w => w.type === "employer_onboarding")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const tabs = [
    { id: "list", label: "List", href: "/employers" },
    { id: "add", label: "Add", href: "/employers/add" },
    { id: "onboarding", label: "Onboarding", href: "/employers/onboarding" },
  ];

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="Employers"
        icon={<Building2 className="text-primary-foreground" size={16} />}
        actions={
          <span className="text-sm text-muted-foreground">
            {onboardingWizards.length} Onboarding{onboardingWizards.length !== 1 ? "s" : ""}
          </span>
        }
      />

      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant={location === tab.href ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-employers-${tab.id}`}
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
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg font-medium">Employer Onboarding Wizards</CardTitle>
            <WizardLauncher
              type="employer_onboarding"
              successTitle="Onboarding wizard created"
              renderTrigger={({ onClick, disabled, isPending }) => (
                <Button
                  size="sm"
                  onClick={onClick}
                  disabled={disabled}
                  data-testid="button-new-onboarding"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {isPending ? "Creating..." : "New Onboarding"}
                </Button>
              )}
            />
          </CardHeader>
          <CardContent>
            {wizardsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : onboardingWizards.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <ClipboardList className="text-muted-foreground" size={32} />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">No Onboarding Wizards Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Start a new employer onboarding to get started
                </p>
                <WizardLauncher
                  type="employer_onboarding"
                  successTitle="Onboarding wizard created"
                  renderTrigger={({ onClick, disabled, isPending }) => (
                    <Button
                      variant="outline"
                      onClick={onClick}
                      disabled={disabled}
                      data-testid="button-create-first-onboarding"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {isPending ? "Creating..." : "Start First Onboarding"}
                    </Button>
                  )}
                />
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Employer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Current Step</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {onboardingWizards.map((wizard) => {
                      const employerName = wizard.data?.employerName || "—";
                      const employerId = wizard.data?.employerId;
                      return (
                        <TableRow
                          key={wizard.id}
                          className="cursor-pointer"
                          onClick={() => setLocation(`/wizards/${wizard.id}`)}
                          data-testid={`row-onboarding-${wizard.id}`}
                        >
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(wizard.date), "PPp")}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{employerName}</span>
                              {employerId && (
                                <span className="text-xs text-muted-foreground">Created</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusBadgeVariant(wizard.status)}>
                              {wizard.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{getStepLabel(wizard.currentStep)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLocation(`/wizards/${wizard.id}`);
                              }}
                              data-testid={`button-view-onboarding-${wizard.id}`}
                            >
                              {wizard.status === "completed" ? "View" : "Continue"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
