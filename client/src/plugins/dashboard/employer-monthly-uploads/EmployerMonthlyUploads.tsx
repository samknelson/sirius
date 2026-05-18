import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Calendar, ExternalLink } from "lucide-react";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";
import { format, subMonths } from "date-fns";

interface MyWizardType {
  name: string;
  displayName: string;
  isMonthly: boolean;
}

interface DefaultContent {
  wizardTypes: MyWizardType[];
}

interface EmployerMonthlyStats {
  totalActiveEmployers: number;
  byStatus: Record<string, number>;
}

function generateMonthOptions() {
  const options: Array<{ value: string; label: string; year: number; month: number }> = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const date = subMonths(now, i);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    options.push({
      value: `${year}-${month}`,
      label: format(date, "MMMM yyyy"),
      year,
      month,
    });
  }
  return options;
}

function formatStatusName(status: string): string {
  if (status === "no_upload") return "No Upload";
  if (status === "in_progress") return "In Progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function EmployerMonthlyUploads(_props: DashboardPluginProps) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${now.getMonth() + 1}`);

  const monthOptions = generateMonthOptions();
  const selectedOption = monthOptions.find((opt) => opt.value === selectedMonth);

  const { data } = useDashboardContent<DefaultContent>("employer-monthly-uploads");
  const wizardTypes = data?.wizardTypes ?? [];

  if (wizardTypes.length === 0) {
    return null;
  }

  return (
    <Card data-testid="plugin-employer-monthly-uploads" className="md:col-span-2 lg:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Employer Monthly Uploads
        </CardTitle>
        <CardDescription>
          Active employer upload statistics by status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[200px]" data-testid="select-month-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} data-testid={`select-option-${option.value}`}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {wizardTypes.map((wizardType) => (
            <StatsCard
              key={wizardType.name}
              wizardType={wizardType}
              year={selectedOption?.year || now.getFullYear()}
              month={selectedOption?.month || now.getMonth() + 1}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface StatsCardProps {
  wizardType: MyWizardType;
  year: number;
  month: number;
}

function StatsCard({ wizardType, year, month }: StatsCardProps) {
  const [, setLocation] = useLocation();

  const { data: stats, isLoading } = useDashboardContent<EmployerMonthlyStats>(
    "employer-monthly-uploads",
    {
      action: "stats",
      params: { year, month, wizardType: wizardType.name },
    },
  );

  const handleNavigate = (status?: string) => {
    const params = new URLSearchParams({
      year: year.toString(),
      month: month.toString(),
      wizardType: wizardType.name,
    });
    if (status) params.set("status", status);
    setLocation(`/employers/monthly-uploads?${params.toString()}`);
  };

  if (isLoading) {
    return (
      <Card data-testid={`stats-card-${wizardType.name}-loading`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{wizardType.displayName}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const statusOrder = ["completed", "in_progress", "draft", "no_upload", "error", "cancelled"];
  const displayStatuses = statusOrder.filter((status) => (stats.byStatus[status] || 0) > 0);

  return (
    <Card data-testid={`stats-card-${wizardType.name}`}>
      <CardHeader className="pb-2">
        <CardTitle
          className="text-sm font-medium cursor-pointer hover:underline flex items-center gap-1"
          onClick={() => handleNavigate()}
          data-testid={`card-title-${wizardType.name}`}
        >
          {wizardType.displayName}
          <ExternalLink className="h-3 w-3" />
        </CardTitle>
        <CardDescription className="text-xs">
          {stats.totalActiveEmployers} active employers
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {displayStatuses.map((status) => {
            const count = stats.byStatus[status] || 0;
            const percentage = stats.totalActiveEmployers > 0
              ? ((count / stats.totalActiveEmployers) * 100).toFixed(0)
              : "0";
            return (
              <div
                key={status}
                className="flex items-center justify-between text-sm cursor-pointer hover:bg-accent rounded px-2 py-1 -mx-2"
                onClick={() => handleNavigate(status)}
                data-testid={`stat-${wizardType.name}-${status}`}
              >
                <span className="text-muted-foreground">{formatStatusName(status)}</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium" data-testid={`stat-count-${wizardType.name}-${status}`}>
                    {count}
                  </span>
                  <span className="text-xs text-muted-foreground w-10 text-right">
                    ({percentage}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
