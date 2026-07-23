import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Calendar, Hash, ExternalLink, Plus } from "lucide-react";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { WizardLauncher } from "@/components/wizards/WizardLauncher";

interface ReportSummary {
  type: string;
  displayName: string;
  wizardId: string | null;
  generatedAt: string | null;
  recordCount: number | null;
}

interface ReportsContent {
  reports: ReportSummary[];
}

export function Reports(_props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<ReportsContent>("reports");

  if (isLoading || !data) return null;
  if (data.reports.length === 0) return null;

  return (
    <>
      {data.reports.map((report) => {
        const generatedAt = report.generatedAt ? new Date(report.generatedAt) : null;
        return (
          <Card key={report.type} data-testid={`plugin-reports-${report.type}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {report.displayName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.wizardId ? (
                <Link
                  href={`/wizards/${report.wizardId}`}
                  data-testid={`report-link-${report.type}`}
                  className="group block"
                >
                  <div className="space-y-2 text-sm">
                    {generatedAt && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span data-testid={`report-date-${report.type}`}>
                          Last run: {format(generatedAt, "MMM d, yyyy h:mm a")} (
                          {formatDistanceToNow(generatedAt, { addSuffix: true })})
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Hash className="h-4 w-4" />
                      <span data-testid={`report-count-${report.type}`}>
                        {report.recordCount ?? 0}{" "}
                        {report.recordCount === 1 ? "record" : "records"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-primary group-hover:underline">
                      View Report
                      <ExternalLink className="h-4 w-4" />
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span data-testid={`report-date-${report.type}`}>Never run</span>
                  </div>
                </div>
              )}
              <div className="mt-3">
                <WizardLauncher
                  type={report.type}
                  successTitle="Report Created"
                  successDescription="The report wizard has been created successfully."
                  dialogTitle={`New ${report.displayName}`}
                  renderTrigger={({ onClick, disabled, isPending }) => (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onClick}
                      disabled={disabled}
                      data-testid={`button-launch-report-${report.type}`}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {isPending ? "Creating..." : "New Report"}
                    </Button>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
