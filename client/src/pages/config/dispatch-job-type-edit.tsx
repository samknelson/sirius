import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DispatchJobTypeLayout, useDispatchJobTypeLayout } from "@/components/layouts/DispatchJobTypeLayout";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
import { insertDispatchJobTypeSchema, type InsertDispatchJobType, type JobTypeData } from "@shared/schema";

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
  }, [jobType, jobTypeData, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: InsertDispatchJobType) => {
      const updatedData: JobTypeData = {
        ...jobTypeData,
        icon: formIcon,
      };
      return apiRequest("PUT", `/api/dispatch-job-types/${jobType.id}`, {
        ...data,
        data: updatedData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-types", jobType.id] });
      toast({
        title: "Success",
        description: "Job type updated successfully.",
      });
      setLocation(`/config/dispatch-job-type/${jobType.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update job type.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertDispatchJobType) => {
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
  return (
    <DispatchJobTypeLayout activeTab="edit">
      <DispatchJobTypeEditContent />
    </DispatchJobTypeLayout>
  );
}
