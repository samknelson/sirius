import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar,
  ClipboardList, Package, MapPin, Users,
  type LucideIcon
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar,
  ClipboardList, Package, MapPin, Users,
};

function DispatchJobDetailsContent() {
  const { job } = useDispatchJobLayout();

  const JobTypeIcon = job.jobType?.data && typeof job.jobType.data === 'object' && 'icon' in job.jobType.data
    ? iconMap[job.jobType.data.icon as string] || Briefcase
    : Briefcase;

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-details">Job Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Title</h3>
            <p className="text-foreground" data-testid="text-title">{job.title}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Status</h3>
            <p className="text-foreground capitalize" data-testid="text-status">{job.status}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Employer</h3>
            <p className="text-foreground" data-testid="text-employer">{job.employer?.name || "Unknown"}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Job Type</h3>
            <div className="flex items-center gap-2" data-testid="text-jobtype">
              <JobTypeIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-foreground">{job.jobType?.name || "No type"}</span>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Start Date</h3>
            <p className="text-foreground" data-testid="text-startdate">
              {format(new Date(job.startDate), "PPP")}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Created</h3>
            <p className="text-foreground" data-testid="text-created">
              {format(new Date(job.createdAt), "PPP")}
            </p>
          </div>
        </div>
        {job.description && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
            <p className="text-foreground whitespace-pre-wrap" data-testid="text-description">
              {job.description}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DispatchJobDetailsPage() {
  return (
    <DispatchJobLayout activeTab="details">
      <DispatchJobDetailsContent />
    </DispatchJobLayout>
  );
}
