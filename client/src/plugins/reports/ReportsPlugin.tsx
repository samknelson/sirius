import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Calendar, Hash, ExternalLink } from "lucide-react";
import { DashboardPluginProps } from "../types";
import { Link } from "wouter";
import { format } from "date-fns";

interface Wizard {
  id: string;
  type: string;
  name: string;
  status: string;
  data?: {
    reportMeta?: {
      generatedAt: string;
      recordCount: number;
    };
  };
}

interface ReportType {
  name: string;
  displayName: string;
  description: string;
  isReport?: boolean;
}

export function ReportsPlugin({ userRoles }: DashboardPluginProps) {
  const { data: reportsSettings = {}, isLoading: settingsLoading } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/dashboard-plugins/reports/settings"],
  });

  // Fetch wizard types to get display names
  const { data: wizardTypes = [], isLoading: typesLoading } = useQuery<ReportType[]>({
    queryKey: ["/api/wizard-types"],
  });

  // Get all report types the user should see based on their roles
  const userReportTypes = new Set<string>();
  userRoles.forEach(role => {
    const roleReports = reportsSettings[role.id] || [];
    roleReports.forEach(reportType => userReportTypes.add(reportType));
  });

  // Fetch all wizards that match the user's report types
  const { data: allWizards = [], isLoading: wizardsLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards"],
    enabled: userReportTypes.size > 0
  });

  if (settingsLoading || wizardsLoading || typesLoading) {
    return null;
  }

  // Create a map of report type names to display names
  const reportTypeMap = new Map<string, string>();
  wizardTypes
    .filter(type => type.isReport)
    .forEach(type => reportTypeMap.set(type.name, type.displayName));

  // If no reports configured, don't render
  if (userReportTypes.size === 0) {
    return null;
  }

  // Find the most recent wizard for each report type
  const reportWizards = new Map<string, Wizard>();
  Array.from(userReportTypes).forEach(reportType => {
    const wizardsOfType = allWizards
      .filter(w => w.type === reportType)
      .sort((a, b) => {
        const aDate = a.data?.reportMeta?.generatedAt || '';
        const bDate = b.data?.reportMeta?.generatedAt || '';
        return bDate.localeCompare(aDate); // Most recent first
      });
    
    if (wizardsOfType.length > 0) {
      reportWizards.set(reportType, wizardsOfType[0]);
    }
  });

  // If no reports have been run, don't render
  if (reportWizards.size === 0) {
    return null;
  }

  return (
    <>
      {Array.from(reportWizards.entries()).map(([reportType, wizard]) => {
        const displayName = reportTypeMap.get(reportType) || reportType;
        const reportMeta = wizard.data?.reportMeta;
        const generatedAt = reportMeta?.generatedAt ? new Date(reportMeta.generatedAt) : null;
        const recordCount = reportMeta?.recordCount ?? 0;

        return (
          <Card key={reportType} data-testid={`plugin-reports-${reportType}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {displayName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Link 
                href={`/wizards/${wizard.id}`}
                data-testid={`report-link-${reportType}`}
              >
                <div className="group cursor-pointer rounded-lg border p-4 transition-colors hover:bg-accent hover:text-accent-foreground">
                  <div className="space-y-2 text-sm">
                    {generatedAt && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span data-testid={`report-date-${reportType}`}>
                          Last run: {format(generatedAt, 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Hash className="h-4 w-4" />
                      <span data-testid={`report-count-${reportType}`}>
                        {recordCount} {recordCount === 1 ? 'record' : 'records'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-primary group-hover:underline">
                      View Report
                      <ExternalLink className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
