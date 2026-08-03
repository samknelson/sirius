import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DispatchJobTypeLayout, useDispatchJobTypeLayout } from "@/components/layouts/DispatchJobTypeLayout";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Loader2, Briefcase, Truck, HardHat, Wrench, Clock, Calendar, ClipboardList, Package, MapPin, Users, type LucideIcon } from "lucide-react";
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
import { insertDispatchJobTypeSchema, type InsertDispatchJobType, type JobTypeData, type JobTypePrimarySetting, type JobTypeBullpenSetting } from "@shared/schema";

const bullpenOptions: { value: JobTypeBullpenSetting; label: string }[] = [
  { value: "none", label: "None" },
  { value: "host", label: "Host" },
  { value: "shared", label: "Shared" },
];

const primaryOptions: { value: JobTypePrimarySetting; label: string }[] = [
  { value: "primary", label: "Always primary" },
  { value: "both", label: "Primary if possible, otherwise secondary" },
  { value: "secondary", label: "Always secondary" },
];

const availableIcons: { name: string; Icon: LucideIcon }[] = [
  { name: 'Briefcase', Icon: Briefcase },
  { name: 'Truck', Icon: Truck },
  { name: 'HardHat', Icon: HardHat },
  { name: 'Wrench', Icon: Wrench },
  { name: 'Clock', Icon: Clock },
  { name: 'Calendar', Icon: Calendar },
  { name: 'ClipboardList', Icon: ClipboardList },
  { name: 'Package', Icon: Package },
  { name: 'MapPin', Icon: MapPin },
  { name: 'Users', Icon: Users },
];

function DispatchJobTypeEditContent() {
  const { jobType } = useDispatchJobTypeLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const jobTypeData = jobType.data as JobTypeData | undefined;
  const [formIcon, setFormIcon] = useState<string>(jobTypeData?.icon || "Briefcase");
  const [minWorkers, setMinWorkers] = useState<string>(jobTypeData?.minWorkers?.toString() || "");
  const [maxWorkers, setMaxWorkers] = useState<string>(jobTypeData?.maxWorkers?.toString() || "");
  const [primarySetting, setPrimarySetting] = useState<JobTypePrimarySetting>(jobTypeData?.primary || "secondary");
  const [bullpenSetting, setBullpenSetting] = useState<JobTypeBullpenSetting>(jobTypeData?.bullpen || "none");
  const [bullpenEventTypeId, setBullpenEventTypeId] = useState<string>(jobTypeData?.bullpenEventTypeId || "");
  const [bullpenEventTypeError, setBullpenEventTypeError] = useState<string | null>(null);

  const { data: componentConfigs = [] } = useQuery<{ componentId: string; enabled: boolean }[]>({
    queryKey: ["/api/components/config"],
  });
  const bullpenComponentEnabled = componentConfigs.some(
    (c) => c.componentId === "dispatch.bullpen" && c.enabled,
  );

  const { data: eventTypes = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/options/event-type"],
    enabled: bullpenComponentEnabled,
  });

  const form = useForm<InsertDispatchJobType>({
    resolver: zodResolver(insertDispatchJobTypeSchema),
    defaultValues: {
      name: jobType.name,
      description: jobType.description || "",
    },
  });

  useEffect(() => {
    form.reset({
      name: jobType.name,
      description: jobType.description || "",
    });
    setFormIcon(jobTypeData?.icon || "Briefcase");
    setMinWorkers(jobTypeData?.minWorkers?.toString() || "");
    setMaxWorkers(jobTypeData?.maxWorkers?.toString() || "");
    setPrimarySetting(jobTypeData?.primary || "secondary");
    setBullpenSetting(jobTypeData?.bullpen || "none");
    setBullpenEventTypeId(jobTypeData?.bullpenEventTypeId || "");
    setBullpenEventTypeError(null);
  }, [jobType, jobTypeData, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: InsertDispatchJobType) => {
      const updatedData: JobTypeData = {
        ...jobTypeData,
        icon: formIcon,
        minWorkers: minWorkers ? parseInt(minWorkers, 10) : undefined,
        maxWorkers: maxWorkers ? parseInt(maxWorkers, 10) : undefined,
        primary: primarySetting,
      };
      if (bullpenComponentEnabled) {
        if (bullpenSetting === "none") {
          updatedData.bullpen = "none";
          delete updatedData.bullpenEventTypeId;
        } else {
          updatedData.bullpen = bullpenSetting;
          updatedData.bullpenEventTypeId = bullpenEventTypeId;
        }
      }
      return apiRequest("PUT", `/api/options/dispatch-job-type/${jobType.id}`, {
        ...data,
        data: updatedData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type", jobType.id] });
      toast({
        title: "Success",
        description: "Job type updated successfully.",
      });
      setLocation(`/config/dispatch-job-type/${jobType.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to update job type."),
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertDispatchJobType) => {
    if (
      bullpenComponentEnabled &&
      (bullpenSetting === "host" || bullpenSetting === "shared") &&
      !bullpenEventTypeId
    ) {
      setBullpenEventTypeError("An event type is required when Bullpen is set to Host or Shared.");
      return;
    }
    setBullpenEventTypeError(null);
    updateMutation.mutate(data);
  };

  const SelectedIcon = availableIcons.find(i => i.name === formIcon)?.Icon || Briefcase;

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-edit">Edit Job Type</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>Icon</FormLabel>
              <Select value={formIcon} onValueChange={setFormIcon}>
                <SelectTrigger data-testid="select-icon">
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      <SelectedIcon className="h-4 w-4" />
                      {formIcon}
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableIcons.map(({ name, Icon }) => (
                    <SelectItem key={name} value={name}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <FormLabel>Primary?</FormLabel>
              <Select value={primarySetting} onValueChange={(v) => setPrimarySetting(v as JobTypePrimarySetting)}>
                <SelectTrigger data-testid="select-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {primaryOptions.map(({ value, label }) => (
                    <SelectItem key={value} value={value} data-testid={`option-primary-${value}`}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Controls whether dispatches for this job type are marked as the worker's primary dispatch.
              </p>
            </div>

            {bullpenComponentEnabled && (
              <>
                <div className="space-y-2">
                  <FormLabel>Bullpen?</FormLabel>
                  <Select
                    value={bullpenSetting}
                    onValueChange={(v) => {
                      const next = v as JobTypeBullpenSetting;
                      setBullpenSetting(next);
                      if (next === "none") {
                        setBullpenEventTypeId("");
                        setBullpenEventTypeError(null);
                      }
                    }}
                  >
                    <SelectTrigger data-testid="select-bullpen">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {bullpenOptions.map(({ value, label }) => (
                        <SelectItem key={value} value={value} data-testid={`option-bullpen-${value}`}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Whether this job type hosts a bullpen or shares one.
                  </p>
                </div>

                {(bullpenSetting === "host" || bullpenSetting === "shared") && (
                  <div className="space-y-2">
                    <FormLabel>Event Type</FormLabel>
                    <Select
                      value={bullpenEventTypeId}
                      onValueChange={(v) => {
                        setBullpenEventTypeId(v);
                        setBullpenEventTypeError(null);
                      }}
                    >
                      <SelectTrigger data-testid="select-bullpen-event-type">
                        <SelectValue placeholder="Select an event type" />
                      </SelectTrigger>
                      <SelectContent>
                        {eventTypes.map((et) => (
                          <SelectItem key={et.id} value={et.id} data-testid={`option-event-type-${et.id}`}>
                            {et.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {bullpenEventTypeError && (
                      <p className="text-sm font-medium text-destructive" data-testid="error-bullpen-event-type">
                        {bullpenEventTypeError}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Required for host or shared bullpens.
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <FormLabel>Minimum Workers</FormLabel>
                <Input
                  type="number"
                  min="0"
                  value={minWorkers}
                  onChange={(e) => setMinWorkers(e.target.value)}
                  placeholder="No minimum"
                  data-testid="input-min-workers"
                />
              </div>
              <div className="space-y-2">
                <FormLabel>Maximum Workers</FormLabel>
                <Input
                  type="number"
                  min="0"
                  value={maxWorkers}
                  onChange={(e) => setMaxWorkers(e.target.value)}
                  placeholder="No maximum"
                  data-testid="input-max-workers"
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ""} data-testid="input-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save">
                {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setLocation(`/config/dispatch-job-type/${jobType.id}`)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function DispatchJobTypeEditPage() {
  usePageTitle("Edit Job Type");
  return (
    <DispatchJobTypeLayout activeTab="edit">
      <DispatchJobTypeEditContent />
    </DispatchJobTypeLayout>
  );
}
