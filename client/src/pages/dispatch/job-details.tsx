import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar,
  ClipboardList, Package, MapPin, Users,
  type LucideIcon
} from "lucide-react";
import { renderIcon } from "@/components/ui/icon-picker";
import type { OptionsSkill } from "@shared/schema";

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
