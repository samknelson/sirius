import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2, Clock, MapPin, School, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { BtuSchoolAttributes, BtuScheduleItem, BtuSchoolType, BtuRegion } from "@shared/schema/sitespecific/btu/schema";
import { btuScheduleItemSchema } from "@shared/schema/sitespecific/btu/schema";

const formSchema = z.object({
  siriusId: z.string().min(1, "Sirius ID is required"),
  schoolTypeIds: z.array(z.string()),
  schedules: z.array(btuScheduleItemSchema),
  regionId: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

function SchoolAttributesContent() {
  const { employer } = useEmployerLayout();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: schoolAttributes, isLoading: attributesLoading, error: attributesError } = useQuery<BtuSchoolAttributes | null>({
    queryKey: ["/api/sitespecific/btu/school-attributes/employer", employer.id],
    queryFn: async () => {
      const response = await fetch(`/api/sitespecific/btu/school-attributes/employer/${employer.id}`);
      if (!response.ok) {
        if (response.status === 503) {
          return null;
        }
        throw new Error("Failed to fetch school attributes");
      }
      return response.json();
    },
  });

  const { data: schoolTypes = [] } = useQuery<BtuSchoolType[]>({
    queryKey: ["/api/sitespecific/btu/school-types"],
  });

  const { data: regions = [] } = useQuery<BtuRegion[]>({
    queryKey: ["/api/sitespecific/btu/regions"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      siriusId: "",
      schoolTypeIds: [],
      schedules: [],
      regionId: null,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "schedules",
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      return apiRequest("POST", "/api/sitespecific/btu/school-attributes", {
        ...data,
        employerId: employer.id,
        schedules: data.schedules.length > 0 ? data.schedules : null,
        regionId: data.regionId || null,
        schoolTypeIds: data.schoolTypeIds.length > 0 ? data.schoolTypeIds : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/school-attributes/employer", employer.id] });
      toast({
        title: "School Attributes Created",
        description: "The school attributes have been created successfully.",
      });
      setIsCreating(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Create Failed",
        description: error?.message || "Failed to create school attributes.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormValues }) => {
      return apiRequest("PATCH", `/api/sitespecific/btu/school-attributes/${id}`, {
        ...data,
        schedules: data.schedules.length > 0 ? data.schedules : null,
        regionId: data.regionId || null,
        schoolTypeIds: data.schoolTypeIds.length > 0 ? data.schoolTypeIds : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/school-attributes/employer", employer.id] });
      toast({
        title: "School Attributes Updated",
        description: "The school attributes have been updated successfully.",
      });
      setIsEditing(false);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update school attributes.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/btu/school-attributes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/school-attributes/employer", employer.id] });
      toast({
        title: "School Attributes Deleted",
        description: "The school attributes have been deleted.",
      });
      setDeleteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error?.message || "Failed to delete school attributes.",
        variant: "destructive",
      });
    },
  });

  const openEditDialog = () => {
    if (schoolAttributes) {
      const schedules = (schoolAttributes.schedules as BtuScheduleItem[] | null) || [];
      form.reset({
        siriusId: schoolAttributes.siriusId,
        schoolTypeIds: schoolAttributes.schoolTypeIds || [],
        schedules: schedules,
        regionId: schoolAttributes.regionId || null,
      });
      setIsEditing(true);
    }
  };

  const openCreateDialog = () => {
    form.reset({
      siriusId: "",
      schoolTypeIds: [],
      schedules: [],
      regionId: null,
    });
    setIsCreating(true);
  };

  const onSubmit = (data: FormValues) => {
    if (isEditing && schoolAttributes) {
      updateMutation.mutate({ id: schoolAttributes.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleSchoolTypeToggle = (typeId: string) => {
    const current = form.getValues("schoolTypeIds");
    if (current.includes(typeId)) {
      form.setValue("schoolTypeIds", current.filter(id => id !== typeId));
    } else {
      form.setValue("schoolTypeIds", [...current, typeId]);
    }
  };

  const getSchoolTypeName = (typeId: string) => {
    return schoolTypes.find(t => t.id === typeId)?.name || typeId;
  };

  const getRegionName = (regionId: string | null) => {
    if (!regionId) return "None";
    return regions.find(r => r.id === regionId)?.name || regionId;
  };

  if (attributesLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (attributesError) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-destructive">
          Failed to load school attributes. The BTU module may not be enabled.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle data-testid="title-school-attributes">School Attributes</CardTitle>
              <CardDescription>
                School-specific attributes for {employer.name}
              </CardDescription>
            </div>
            {schoolAttributes && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openEditDialog}
                  data-testid="button-edit-school-attributes"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  data-testid="button-delete-school-attributes"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!schoolAttributes ? (
            <div className="text-center py-8">
              <School className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">No school attributes configured for this employer.</p>
              <Button onClick={openCreateDialog} data-testid="button-add-school-attributes">
                <Plus className="h-4 w-4 mr-2" />
                Add School Attributes
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label className="text-muted-foreground text-sm">Sirius ID</Label>
                  <p className="font-medium" data-testid="text-sirius-id">{schoolAttributes.siriusId}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-sm">Region</Label>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium" data-testid="text-region">
                      {getRegionName(schoolAttributes.regionId)}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground text-sm">School Types</Label>
                <div className="flex flex-wrap gap-2 mt-2" data-testid="school-types-list">
                  {schoolAttributes.schoolTypeIds && schoolAttributes.schoolTypeIds.length > 0 ? (
                    schoolAttributes.schoolTypeIds.map((typeId) => (
                      <Badge key={typeId} variant="secondary" data-testid={`badge-school-type-${typeId}`}>
                        {getSchoolTypeName(typeId)}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-sm">No school types assigned</p>
                  )}
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground text-sm">Schedules</Label>
                <div className="mt-2 space-y-2" data-testid="schedules-list">
                  {schoolAttributes.schedules && (schoolAttributes.schedules as BtuScheduleItem[]).length > 0 ? (
                    (schoolAttributes.schedules as BtuScheduleItem[]).map((schedule, index) => (
                      <div key={index} className="flex items-center gap-4 p-3 bg-muted/50 rounded-md" data-testid={`schedule-${index}`}>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{schedule.label}</span>
                        <span className="text-muted-foreground">
                          {schedule.startTime} - {schedule.endTime}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-sm">No schedules configured</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete School Attributes</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the school attributes for this employer? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => schoolAttributes && deleteMutation.mutate(schoolAttributes.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditing || isCreating} onOpenChange={(open) => {
        if (!open) {
          setIsEditing(false);
          setIsCreating(false);
          form.reset();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit School Attributes" : "Add School Attributes"}</DialogTitle>
            <DialogDescription>
              {isEditing ? "Update the school attributes for this employer." : "Configure school attributes for this employer."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="siriusId"
                rules={{ required: "Sirius ID is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sirius ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., SCH001" data-testid="input-sirius-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="regionId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Region</FormLabel>
                    <Select
                      value={field.value || "none"}
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-region">
                          <SelectValue placeholder="Select a region" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {regions.map((region) => (
                          <SelectItem key={region.id} value={region.id}>
                            {region.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <Label className="mb-2 block">School Types</Label>
                <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px]" data-testid="school-types-selector">
                  {schoolTypes.map((type) => {
                    const isSelected = form.watch("schoolTypeIds").includes(type.id);
                    return (
                      <Badge
                        key={type.id}
                        variant={isSelected ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => handleSchoolTypeToggle(type.id)}
                        data-testid={`toggle-school-type-${type.id}`}
                      >
                        {type.name}
                        {isSelected && <X className="h-3 w-3 ml-1" />}
                      </Badge>
                    );
                  })}
                  {schoolTypes.length === 0 && (
                    <p className="text-muted-foreground text-sm">No school types available</p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Schedules</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ label: "", startTime: "", endTime: "" })}
                    data-testid="button-add-schedule"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Schedule
                  </Button>
                </div>
                <div className="space-y-3">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex items-end gap-3 p-3 border rounded-md">
                      <FormField
                        control={form.control}
                        name={`schedules.${index}.label`}
                        rules={{ required: "Label is required" }}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-xs">Label</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="e.g., Morning" data-testid={`input-schedule-label-${index}`} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`schedules.${index}.startTime`}
                        rules={{ required: "Start time is required" }}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-xs">Start Time</FormLabel>
                            <FormControl>
                              <Input {...field} type="time" data-testid={`input-schedule-start-${index}`} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`schedules.${index}.endTime`}
                        rules={{ required: "End time is required" }}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-xs">End Time</FormLabel>
                            <FormControl>
                              <Input {...field} type="time" data-testid={`input-schedule-end-${index}`} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(index)}
                        data-testid={`button-remove-schedule-${index}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {fields.length === 0 && (
                    <p className="text-muted-foreground text-sm text-center py-4">No schedules configured. Click "Add Schedule" to add one.</p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => {
                  setIsEditing(false);
                  setIsCreating(false);
                  form.reset();
                }} data-testid="button-cancel-form">
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit-form"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {isEditing ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function EmployerSchoolAttributesPage() {
  return (
    <EmployerLayout activeTab="school-attributes">
      <SchoolAttributesContent />
    </EmployerLayout>
  );
}
