import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Save, X } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { type Employer, type DispatchJobType, type JobTypeData, type OptionsSkill } from "@shared/schema";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { renderIcon } from "@/components/ui/icon-picker";

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

type FormData = {
  title: string;
  description?: string;
  employerId: string;
  jobTypeId: string;
  startDate: string;
  workerCount: string;
};

interface JobData {
  requiredSkills?: string[];
}

function DispatchJobEditContent() {
  const { job } = useDispatchJobLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  
  const jobData = job.data as JobData | null;
  const [selectedSkills, setSelectedSkills] = useState<string[]>(jobData?.requiredSkills || []);

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: jobTypes = [] } = useQuery<DispatchJobType[]>({
    queryKey: ["/api/options/dispatch-job-type"],
  });

  const { data: componentConfigs = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
  });

  const skillsComponentEnabled = componentConfigs.some(
    (c) => c.componentId === "worker.skills" && c.enabled
  );

  const { data: skills = [] } = useQuery<OptionsSkill[]>({
    queryKey: ["/api/options/skill"],
    enabled: skillsComponentEnabled,
  });

  const form = useForm<FormData>({
    defaultValues: {
      title: job.title,
      description: job.description || "",
      employerId: job.employerId,
      jobTypeId: job.jobTypeId || "",
      startDate: format(new Date(job.startDate), "yyyy-MM-dd"),
      workerCount: job.workerCount?.toString() || "",
    },
  });

  const watchedJobTypeId = form.watch("jobTypeId");

  const selectedJobType = useMemo(() => {
    return jobTypes.find(jt => jt.id === watchedJobTypeId);
  }, [jobTypes, watchedJobTypeId]);

  const jobTypeData = selectedJobType?.data as JobTypeData | undefined;
  const minWorkers = jobTypeData?.minWorkers;
  const maxWorkers = jobTypeData?.maxWorkers;
  const isFixedWorkerCount = minWorkers !== undefined && maxWorkers !== undefined && minWorkers === maxWorkers;

  useEffect(() => {
    if (isFixedWorkerCount && minWorkers !== undefined) {
      form.setValue("workerCount", minWorkers.toString());
    }
  }, [isFixedWorkerCount, minWorkers, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const workerCountNum = data.workerCount ? parseInt(data.workerCount, 10) : null;
      const updatedJobData: JobData = {
        ...(jobData ?? {}),
        requiredSkills: selectedSkills.length > 0 ? selectedSkills : undefined,
      };
      const hasData = Object.values(updatedJobData).some((v) => v !== undefined);
      return apiRequest("PUT", `/api/dispatch-jobs/${job.id}`, {
        ...data,
        jobTypeId: data.jobTypeId || null,
        startDate: new Date(data.startDate).toISOString(),
        workerCount: workerCountNum,
        data: hasData ? updatedJobData : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs", job.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs"] });
      toast({
        title: "Success",
        description: "Dispatch job updated successfully.",
      });
      navigate(`/dispatch/job/${job.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update dispatch job.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    if (!data.title.trim()) {
      toast({ title: "Error", description: "Title is required", variant: "destructive" });
      return;
    }
    if (!data.employerId) {
      toast({ title: "Error", description: "Employer is required", variant: "destructive" });
      return;
    }
    if (!data.jobTypeId) {
      toast({ title: "Error", description: "Job type is required", variant: "destructive" });
      return;
    }
    if (!data.startDate) {
      toast({ title: "Error", description: "Start date is required", variant: "destructive" });
      return;
    }

    const workerCountNum = data.workerCount ? parseInt(data.workerCount, 10) : null;
    
    if (workerCountNum === null) {
      toast({ title: "Error", description: "Worker count is required", variant: "destructive" });
      return;
    }

    if (minWorkers !== undefined && workerCountNum < minWorkers) {
      toast({ title: "Error", description: `Worker count must be at least ${minWorkers}`, variant: "destructive" });
      return;
    }

    if (maxWorkers !== undefined && workerCountNum > maxWorkers) {
      toast({ title: "Error", description: `Worker count must be at most ${maxWorkers}`, variant: "destructive" });
      return;
    }

    updateMutation.mutate(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-edit">Edit Job</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Job title" data-testid="input-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Job description"
                      className="min-h-[100px]"
                      data-testid="input-description"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="employerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employer *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-employer">
                          <SelectValue placeholder="Select employer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {employers.map((employer) => (
                          <SelectItem key={employer.id} value={employer.id}>
                            {employer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="jobTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-jobtype">
                          <SelectValue placeholder="Select job type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {jobTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="date"
                        data-testid="input-startdate"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {!isFixedWorkerCount ? (
              <FormField
                control={form.control}
                name="workerCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Worker Count *
                      {minWorkers !== undefined && maxWorkers !== undefined && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          ({minWorkers} - {maxWorkers})
                        </span>
                      )}
                      {minWorkers !== undefined && maxWorkers === undefined && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          (min: {minWorkers})
                        </span>
                      )}
                      {minWorkers === undefined && maxWorkers !== undefined && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          (max: {maxWorkers})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={minWorkers ?? 1}
                        max={maxWorkers}
                        placeholder="Number of workers"
                        data-testid="input-workercount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <input type="hidden" {...form.register("workerCount")} />
            )}

            {skillsComponentEnabled && skills.length > 0 && (
              <div className="space-y-3">
                <FormLabel>Required Skills</FormLabel>
                <div className="flex flex-wrap gap-2 min-h-[36px] p-2 border rounded-md bg-muted/30">
                  {selectedSkills.length === 0 ? (
                    <span className="text-muted-foreground text-sm">No skills required</span>
                  ) : (
                    selectedSkills.map((skillId) => {
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
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 p-0 ml-1"
                            onClick={() => setSelectedSkills(selectedSkills.filter((id) => id !== skillId))}
                            data-testid={`button-remove-skill-${skillId}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </Badge>
                      );
                    })
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {skills
                    .filter((skill) => !selectedSkills.includes(skill.id))
                    .map((skill) => {
                      const skillData = skill.data as { icon?: string } | null;
                      return (
                        <div
                          key={skill.id}
                          className="flex items-center gap-2 p-2 rounded-md border hover-elevate cursor-pointer"
                          onClick={() => setSelectedSkills([...selectedSkills, skill.id])}
                          data-testid={`option-skill-${skill.id}`}
                        >
                          <Checkbox
                            checked={false}
                            onCheckedChange={() => setSelectedSkills([...selectedSkills, skill.id])}
                          />
                          {skillData?.icon && renderIcon(skillData.icon, "h-4 w-4 text-muted-foreground")}
                          <span className="text-sm">{skill.name}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="button-save"
              >
                {updateMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
              <Link href={`/dispatch/job/${job.id}`}>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function DispatchJobEditPage() {
  return (
    <DispatchJobLayout activeTab="edit">
      <DispatchJobEditContent />
    </DispatchJobLayout>
  );
}
