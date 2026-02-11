import { useQuery } from "@tanstack/react-query";
import { formatYmd } from "@shared/utils/date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar,
  ClipboardList, Package, MapPin, Users, Play, Square,
  CheckCircle, XCircle, Bell, Pause, LogOut,
  type LucideIcon
} from "lucide-react";
import { renderIcon } from "@/components/ui/icon-picker";
import type { OptionsSkill } from "@shared/schema";

interface DispatchStatusCounts {
  pending: number;
  notified: number;
  accepted: number;
  layoff: number;
  resigned: number;
  declined: number;
}

const statusConfig: Record<keyof DispatchStatusCounts, { label: string; icon: LucideIcon; color: string }> = {
  pending: { label: "Pending", icon: Clock, color: "text-yellow-600 dark:text-yellow-400" },
  notified: { label: "Notified", icon: Bell, color: "text-blue-600 dark:text-blue-400" },
  accepted: { label: "Accepted", icon: CheckCircle, color: "text-green-600 dark:text-green-400" },
  declined: { label: "Declined", icon: XCircle, color: "text-red-600 dark:text-red-400" },
  layoff: { label: "Layoff", icon: Pause, color: "text-orange-600 dark:text-orange-400" },
  resigned: { label: "Resigned", icon: LogOut, color: "text-muted-foreground" },
};

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

interface JobData {
  requiredSkills?: string[];
}

const iconMap: Record<string, LucideIcon> = {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar,
  ClipboardList, Package, MapPin, Users,
};

function DispatchJobDetailsContent() {
  const { job } = useDispatchJobLayout();
  const jobData = job.data as JobData | null;

  const { data: componentConfigs = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
  });

  const skillsComponentEnabled = componentConfigs.some(
    (c) => c.componentId === "worker.skills" && c.enabled
  );

  const { data: skills = [] } = useQuery<OptionsSkill[]>({
    queryKey: ["/api/options/skill"],
    enabled: skillsComponentEnabled && !!jobData?.requiredSkills?.length,
  });

  const requiredSkills = jobData?.requiredSkills || [];

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
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Running</h3>
            <div data-testid="text-running">
              {job.running ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Play className="h-4 w-4" />
                  <span>Yes</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Square className="h-4 w-4" />
                  <span>No</span>
                </div>
              )}
            </div>
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
              {formatYmd(job.startYmd, 'long')}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Created</h3>
            <p className="text-foreground" data-testid="text-created">
              {new Date(job.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
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
        {job.workerCount != null && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Worker Capacity</h3>
            <div className="space-y-3" data-testid="worker-capacity">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>Accepted Dispatches</span>
                </span>
                <span className="font-medium">
                  {job.acceptedCount ?? 0} / {job.workerCount}
                </span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-300"
                  style={{ 
                    width: `${Math.min(100, ((job.acceptedCount ?? 0) / job.workerCount) * 100)}%` 
                  }}
                  data-testid="progress-bar"
                />
              </div>
              {(job.acceptedCount ?? 0) >= job.workerCount && (
                <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                  Fully staffed
                </p>
              )}
              {job.statusCounts && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t" data-testid="dispatch-status-counts">
                  {(Object.keys(statusConfig) as Array<keyof DispatchStatusCounts>).map((status) => {
                    const config = statusConfig[status];
                    const count = job.statusCounts?.[status] ?? 0;
                    const Icon = config.icon;
                    return (
                      <div 
                        key={status} 
                        className="flex items-center gap-2 text-sm"
                        data-testid={`status-count-${status}`}
                      >
                        <Icon className={`h-4 w-4 ${config.color}`} />
                        <span className="text-muted-foreground">{config.label}:</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        {skillsComponentEnabled && requiredSkills.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Required Skills</h3>
            <div className="flex flex-wrap gap-2" data-testid="skills-list">
              {requiredSkills.map((skillId) => {
                const skill = skills.find((s) => s.id === skillId);
                if (!skill) return null;
                const skillData = skill.data as { icon?: string } | null;
                return (
                  <Badge
                    key={skillId}
                    variant="secondary"
                    className="gap-1"
                    data-testid={`badge-skill-${skillId}`}
                  >
                    {skillData?.icon && renderIcon(skillData.icon, "h-3 w-3")}
                    {skill.name}
                  </Badge>
                );
              })}
            </div>
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
