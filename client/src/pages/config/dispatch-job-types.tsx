import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Loader2, Plus,
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar, 
  ClipboardList, Package, MapPin, Users, Shield, ChevronRight,
  type LucideIcon
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { 
  insertDispatchJobTypeSchema, 
  type DispatchJobType, 
  type InsertDispatchJobType,
  type EligibilityPluginMetadata,
  type EligibilityPluginConfig,
  type JobTypeData,
} from "@shared/schema";

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

function getIconComponent(iconName: string | undefined): LucideIcon {
  const found = availableIcons.find(i => i.name === iconName);
  return found?.Icon || Briefcase;
}

export default function DispatchJobTypesPage() {
  usePageTitle("Dispatch Job Types");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [formIcon, setFormIcon] = useState<string>("Briefcase");
  const [formEligibility, setFormEligibility] = useState<EligibilityPluginConfig[]>([]);
  
  const { data: jobTypes = [], isLoading } = useQuery<DispatchJobType[]>({
    queryKey: ["/api/options/dispatch-job-type"],
  });
  
  const { data: eligibilityPlugins = [] } = useQuery<EligibilityPluginMetadata[]>({
    queryKey: ["/api/dispatch-eligibility-plugins"],
  });

  const addForm = useForm<InsertDispatchJobType>({
    resolver: zodResolver(insertDispatchJobTypeSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const resetFormState = () => {
    setFormIcon("Briefcase");
    setFormEligibility([]);
  };

  const togglePluginEnabled = (pluginId: string) => {
    setFormEligibility(prev => {
      const existing = prev.find(p => p.pluginId === pluginId);
      if (existing) {
        return prev.map(p => p.pluginId === pluginId ? { ...p, enabled: !p.enabled } : p);
      }
      return [...prev, { pluginId, enabled: true, config: {} }];
    });
  };

  const isPluginEnabled = (pluginId: string): boolean => {
    const config = formEligibility.find(p => p.pluginId === pluginId);
    return config?.enabled ?? false;
  };

  const createMutation = useMutation({
    mutationFn: async (data: InsertDispatchJobType) => {
      const jobTypeData: JobTypeData = { 
        icon: formIcon,
        eligibility: formEligibility,
      };
      return apiRequest("POST", "/api/options/dispatch-job-type", {
        ...data,
        data: jobTypeData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type"] });
      setIsAddDialogOpen(false);
      addForm.reset();
      resetFormState();
      toast({
        title: "Success",
        description: "Dispatch job type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create dispatch job type.",
        variant: "destructive",
      });
    },
  });

  const onAddSubmit = (data: InsertDispatchJobType) => {
    createMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle data-testid="title-page">Dispatch Job Types</CardTitle>
              <CardDescription>
                Manage dispatch job types for categorizing dispatch jobs
              </CardDescription>
            </div>
            <Button data-testid="button-add" onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Type
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jobTypes.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-state">
              No dispatch job types configured yet. Click "Add Type" to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Icon</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobTypes.map((type) => {
                  const typeData = type.data as { icon?: string } | null;
                  const IconComponent = getIconComponent(typeData?.icon);
                  
                  return (
                    <TableRow key={type.id} data-testid={`row-type-${type.id}`} className="hover-elevate">
                      <TableCell data-testid={`icon-${type.id}`}>
                        <IconComponent className="h-5 w-5 text-muted-foreground" />
                      </TableCell>
                      <TableCell data-testid={`text-name-${type.id}`}>
                        <Link href={`/config/dispatch-job-type/${type.id}`}>
                          <span className="font-medium hover:underline cursor-pointer">{type.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell data-testid={`text-description-${type.id}`}>
                        {type.description || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>
                        <Link href={`/config/dispatch-job-type/${type.id}`}>
                          <Button variant="ghost" size="icon" data-testid={`button-view-${type.id}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        setIsAddDialogOpen(open);
        if (!open) {
          addForm.reset();
          resetFormState();
        }
      }}>
        <DialogContent data-testid="dialog-add">
          <DialogHeader>
            <DialogTitle>Add Dispatch Job Type</DialogTitle>
            <DialogDescription>
              Create a new dispatch job type to categorize dispatch jobs.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label>Icon</Label>
                <Select value={formIcon} onValueChange={setFormIcon}>
                  <SelectTrigger data-testid="select-add-icon">
                    <SelectValue>
                      {(() => {
                        const SelectedIcon = getIconComponent(formIcon);
                        return (
                          <div className="flex items-center gap-2">
                            <SelectedIcon className="h-4 w-4" />
                            <span>{formIcon}</span>
                          </div>
                        );
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableIcons.map(({ name, Icon }) => (
                      <SelectItem key={name} value={name}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span>{name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <FormField
                control={addForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Full Time, Part Time"
                        data-testid="input-add-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Optional description"
                        rows={3}
                        data-testid="input-add-description"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {eligibilityPlugins.length > 0 && (
                <div className="space-y-3">
                  <Label className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Eligibility Criteria
                  </Label>
                  <div className="space-y-2">
                    {eligibilityPlugins.map((plugin) => (
                      <div
                        key={plugin.id}
                        className="flex items-center justify-between p-3 border rounded-md"
                        data-testid={`eligibility-plugin-${plugin.id}`}
                      >
                        <div className="space-y-0.5">
                          <div className="text-sm font-medium">{plugin.name}</div>
                          <div className="text-xs text-muted-foreground">{plugin.description}</div>
                          {!plugin.componentEnabled && (
                            <div className="text-xs text-muted-foreground italic">Component disabled</div>
                          )}
                        </div>
                        <Switch
                          checked={isPluginEnabled(plugin.id)}
                          onCheckedChange={() => togglePluginEnabled(plugin.id)}
                          disabled={!plugin.componentEnabled}
                          data-testid={`switch-plugin-${plugin.id}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button
                  type="submit"
                  data-testid="button-create"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Type
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
