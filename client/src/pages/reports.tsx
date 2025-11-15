import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileText, ChevronRight, Clock, BarChart3 } from "lucide-react";
import { format } from "date-fns";

interface Wizard {
  id: string;
  date: string;
  type: string;
  status: string;
  entityId: string | null;
  currentStep?: string;
  data: any;
}

interface WizardType {
  name: string;
  displayName: string;
  description?: string;
  isFeed?: boolean;
  entityType?: string;
}

export default function Reports() {
  const [, setLocation] = useLocation();

  const { data: allWizardTypes, isLoading: typesLoading } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const reportTypes = allWizardTypes?.filter(wt => wt.name.startsWith('report_')) || [];

  const { data: allWizards, isLoading: wizardsLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards"],
  });

  const reportWizards = allWizards?.filter(w => w.type.startsWith('report_')) || [];

  // Group reports by type
  const reportsByType = reportTypes.map(reportType => {
    const reportsOfType = reportWizards.filter(w => w.type === reportType.name);
    const sortedReports = reportsOfType.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const mostRecent = sortedReports[0];

    return {
      type: reportType,
      count: reportsOfType.length,
      mostRecent,
    };
  });

  const isLoading = typesLoading || wizardsLoading;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <FileText className="text-primary-foreground" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-reports-title">
              Reports
            </h1>
            <p className="text-sm text-muted-foreground">
              Generate and view worker data reports
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : reportTypes.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">No Report Types Available</h3>
              <p className="text-muted-foreground">
                No report types have been configured yet
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {reportsByType.map(({ type, count, mostRecent }) => (
            <Card 
              key={type.name}
              className="hover:shadow-md transition-shadow"
              data-testid={`card-report-type-${type.name}`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{type.displayName}</CardTitle>
                    {type.description && (
                      <CardDescription className="mt-1">
                        {type.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <BarChart3 className="text-primary" size={20} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {mostRecent ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Most Recent</span>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-foreground">
                          {format(new Date(mostRecent.date), 'PPp')}
                        </span>
                      </div>
                    </div>
                    {mostRecent.data?.reportMeta?.recordCount !== undefined && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Records Found</span>
                        <Badge variant="secondary" data-testid={`badge-record-count-${type.name}`}>
                          {mostRecent.data.reportMeta.recordCount.toLocaleString()}
                        </Badge>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Total Reports</span>
                      <span className="text-foreground font-medium">{count}</span>
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setLocation(`/wizards/${mostRecent.id}`)}
                        data-testid={`button-view-latest-${type.name}`}
                      >
                        View Latest
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onClick={() => setLocation(`/reports/${type.name}`)}
                        data-testid={`button-view-all-${type.name}`}
                      >
                        View All
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground mb-4">
                      No reports generated yet
                    </p>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setLocation(`/reports/${type.name}`)}
                      data-testid={`button-create-first-${type.name}`}
                    >
                      Create Report
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
