import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DispatchJob, DispatchJobData, OptionsSkill } from "@shared/schema";
import type { DispatchFormProps } from "@/lib/dispatch-contributions";
import { FormLabel } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { renderIcon } from "@/components/ui/icon-picker";
import { X } from "lucide-react";
export function RequiredSkillsForm({ data, register }: DispatchFormProps) {
  const [ids, setIds] = useState<string[]>(() => (data as DispatchJobData | null)?.requiredSkills ?? []);
  const { data: skills = [], isError } = useQuery<OptionsSkill[]>({ queryKey: ["/api/options/skill"] });
  useEffect(() => register("worker.skills", {
    prepareData: value => ({ ...value, requiredSkills: ids }),
  }), [register, ids]);
  if (isError) return <div role="alert">Unable to load dispatch skills.</div>;
  if (!skills.length && !ids.length) return null;
  return <div className="space-y-3">
    <FormLabel>Required Skills</FormLabel>
    <div className="flex flex-wrap gap-2 min-h-[36px] p-2 border rounded-md bg-muted/30">
      {!ids.length ? <span className="text-muted-foreground text-sm">No skills required</span> : ids.map(id => {
        const skill = skills.find(s => s.id === id);
        const icon = (skill?.data as { icon?: string } | null)?.icon;
        return <Badge key={id} variant="secondary" className="gap-1" data-testid={`badge-skill-${id}`}>
          {icon && renderIcon(icon, "h-3 w-3")}{skill?.name ?? id}
          <Button type="button" variant="ghost" size="icon" className="h-4 w-4 p-0 ml-1"
            onClick={() => setIds(ids.filter(value => value !== id))} data-testid={`button-remove-skill-${id}`}><X className="h-3 w-3" /></Button>
        </Badge>;
      })}
    </div>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
      {skills.filter(skill => !ids.includes(skill.id)).map(skill => {
        const icon = (skill.data as { icon?: string } | null)?.icon;
        return <label key={skill.id} className="flex items-center gap-2 p-2 rounded-md border hover-elevate cursor-pointer" data-testid={`option-skill-${skill.id}`}>
          <Checkbox checked={false} onCheckedChange={() => setIds([...ids, skill.id])} />
          {icon && renderIcon(icon, "h-4 w-4 text-muted-foreground")}<span className="text-sm">{skill.name}</span>
        </label>;
      })}
    </div>
  </div>;
}
export function RequiredSkillsDetails({ job }: { job: DispatchJob }) {
  const ids = (job.data as DispatchJobData | null)?.requiredSkills ?? [];
  const { data: skills = [] } = useQuery<OptionsSkill[]>({ queryKey: ["/api/options/skill"], enabled: !!ids.length });
  if (!ids.length) return null;
  return <div><h3 className="text-sm font-medium text-muted-foreground mb-2">Required Skills</h3>
    <div className="flex flex-wrap gap-2" data-testid="skills-list">{ids.map(id => {
      const skill = skills.find(s => s.id === id);
      const icon = (skill?.data as { icon?: string } | null)?.icon;
      return <Badge key={id} variant="secondary" className="gap-1" data-testid={`badge-skill-${id}`}>
        {icon && renderIcon(icon, "h-3 w-3")}{skill?.name ?? id}</Badge>;
    })}</div>
  </div>;
}
