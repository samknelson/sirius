import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileOutput, Eye, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";

interface LatestWizardSummary {
  wizardId: string;
  status: string;
  currentStep: string | null;
  currentStepName: string | null;
  stepReachedAt: string | null;
  recordCount: number | null;
}

interface DashboardRow {
  configId: string;
  configName: string | null;
  pluginId: string;
  pluginName: string;
  providerId: string | null;
  providerName: string | null;
  sftpClientId: string | null;
  latestWizard: LatestWizardSummary | null;
}

const WIZARD_TYPE = "trust_provider_edi";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

/**
 * EDI services dashboard: every enabled trust-provider EDI configuration
 * with the status of its most recent generation/delivery wizard, plus
 * actions to view that wizard or start a new run pre-associated with the
 * configuration.
 */
export default function TrustProviderEdiDashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ rows: DashboardRow[] }>({
    queryKey: ["/api/trust/provider-edi/dashboard"],
  });

  const newWizardMutation = useMutation({
    mutationFn: async (configId: string) => {
      // Create the wizard, then satisfy the configuration step through the
      // wizard's own dispatcher (server-side validation of the config), and
      // advance to the parameters step so the user lands past config.
      const wizard = await apiRequest("POST", "/api/wizards", {
        type: WIZARD_TYPE,
        status: "draft",
        data: {},
      });
      await apiRequest(
        "POST",
        `/api/wizards/${wizard.id}/dispatch/config/submit`,
        { input: { configId } },
      );
      await apiRequest("POST", `/api/wizards/${wizard.id}/dispatch/navigate`, {
        direction: "next",
      });
      return wizard.id as string;
    },
    onSuccess: (wizardId) => {
      setLocation(`/wizards/${wizardId}`);
    },
    onError: (error) => {
      toast({
        title: "Could not start wizard",
        description: getApiErrorMessage(error, "Failed to create the EDI wizard"),
        variant: "destructive",
      });
    },
  });

  const rows = data?.rows ?? [];

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16 space-x-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <FileOutput className="text-primary-foreground" size={16} />
            </div>
            <h1
              className="text-xl font-semibold text-foreground"
              data-testid="text-provider-edi-title"
            >
              Provider EDI
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <CardTitle>EDI Configurations</CardTitle>
            <CardDescription>
              Every enabled EDI file configuration with the status of its most
              recent generation/delivery run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground" data-testid="text-no-configs">
                No enabled EDI configurations found. Create one under Config →
                Plugins → Trust Provider EDI.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Configuration</TableHead>
                    <TableHead>File Type</TableHead>
                    <TableHead>Latest Run</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const w = row.latestWizard;
                    return (
                      <TableRow key={row.configId} data-testid={`row-edi-config-${row.configId}`}>
                        <TableCell data-testid={`text-provider-${row.configId}`}>
                          {row.providerName ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.configName || row.pluginName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.pluginName}
                        </TableCell>
                        <TableCell>
                          {w ? (
                            <Badge
                              variant={statusVariant(w.status)}
                              data-testid={`badge-status-${row.configId}`}
                            >
                              {w.status}
                            </Badge>
                          ) : (
                            <span
                              className="text-muted-foreground"
                              data-testid={`text-no-wizard-${row.configId}`}
                            >
                              No runs yet
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {w?.currentStepName ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {w?.stepReachedAt ? (
                            format(new Date(w.stepReachedAt), "PPp")
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {w?.recordCount != null ? (
                            w.recordCount.toLocaleString()
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {w && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setLocation(`/wizards/${w.wizardId}`)}
                                data-testid={`button-view-wizard-${row.configId}`}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Button>
                            )}
                            <Button
                              variant="default"
                              size="sm"
                              disabled={newWizardMutation.isPending}
                              onClick={() => newWizardMutation.mutate(row.configId)}
                              data-testid={`button-new-wizard-${row.configId}`}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              New Wizard
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
