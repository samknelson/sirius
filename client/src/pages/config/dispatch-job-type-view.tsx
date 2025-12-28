import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DispatchJobTypeLayout, useDispatchJobTypeLayout } from "@/components/layouts/DispatchJobTypeLayout";
import { Briefcase, Truck, HardHat, Wrench, Clock, Calendar, ClipboardList, Package, MapPin, Users, type LucideIcon } from "lucide-react";
import type { JobTypeData } from "@shared/schema";

const iconMap: Record<string, LucideIcon> = {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar, ClipboardList, Package, MapPin, Users,
};

function DispatchJobTypeViewContent() {
  const { jobType } = useDispatchJobTypeLayout();
  const jobTypeData = jobType.data as JobTypeData | undefined;
  const IconComponent = jobTypeData?.icon ? iconMap[jobTypeData.icon] || Briefcase : Briefcase;
  const enabledPlugins = (jobTypeData?.eligibility || []).filter(p => p.enabled);

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-details">Job Type Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Name</h3>
            <p className="text-foreground" data-testid="text-name">{jobType.name}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Icon</h3>
            <div className="flex items-center gap-2" data-testid="text-icon">
              <IconComponent className="h-5 w-5 text-muted-foreground" />
              <span className="text-foreground">{jobTypeData?.icon || "Briefcase"}</span>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Minimum Workers</h3>
            <p className="text-foreground" data-testid="text-min-workers">
              {jobTypeData?.minWorkers !== undefined ? jobTypeData.minWorkers : "Not set"}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Maximum Workers</h3>
            <p className="text-foreground" data-testid="text-max-workers">
              {jobTypeData?.maxWorkers !== undefined ? jobTypeData.maxWorkers : "Not set"}
            </p>
          </div>
        </div>
        
        {jobType.description && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
            <p className="text-foreground whitespace-pre-wrap" data-testid="text-description">
              {jobType.description}
            </p>
          </div>
        )}

        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Enabled Eligibility Plugins</h3>
          {enabledPlugins.length > 0 ? (
            <ul className="list-disc list-inside text-foreground" data-testid="text-plugins">
              {enabledPlugins.map(p => (
                <li key={p.pluginId}>{p.pluginId}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground" data-testid="text-no-plugins">No eligibility plugins enabled</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DispatchJobTypeViewPage() {
  return (
    <DispatchJobTypeLayout activeTab="view">
      <DispatchJobTypeViewContent />
    </DispatchJobTypeLayout>
  );
}
