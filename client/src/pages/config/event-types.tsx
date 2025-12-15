import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { 
  Loader2, Plus, Edit, Trash2, Save, X,
  Calendar, Users, MapPin, Video, Presentation, 
  Mic, Ticket, Star, Heart, Clock,
  type LucideIcon
} from "lucide-react";

interface EventCategoryRole {
  id: string;
  label: string;
  canManageParticipants?: boolean;
}

interface EventCategoryStatus {
  id: string;
  label: string;
}

interface EventCategoryConfigOption {
  key: string;
  label: string;
  type: "number" | "boolean" | "string" | "select";
  options?: { value: string; label: string }[];
  defaultValue?: any;
  description?: string;
  scope: "type" | "event" | "both";
}

interface EventCategory {
  id: string;
  label: string;
  description?: string;
  roles: EventCategoryRole[];
  statuses: EventCategoryStatus[];
  configOptions: EventCategoryConfigOption[];
}
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
import { Label } from "@/components/ui/label";
import { insertEventTypeSchema, type EventType, type InsertEventType } from "@shared/schema";

const availableIcons: { name: string; Icon: LucideIcon }[] = [
  { name: 'Calendar', Icon: Calendar },
  { name: 'Users', Icon: Users },
  { name: 'MapPin', Icon: MapPin },
  { name: 'Video', Icon: Video },
  { name: 'Presentation', Icon: Presentation },
  { name: 'Mic', Icon: Mic },
  { name: 'Ticket', Icon: Ticket },
  { name: 'Star', Icon: Star },
  { name: 'Heart', Icon: Heart },
  { name: 'Clock', Icon: Clock },
];

export default function EventTypesPage() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formIcon, setFormIcon] = useState<string>("Calendar");
  const [formCategory, setFormCategory] = useState<string>("public");
  const [formConfig, setFormConfig] = useState<Record<string, any>>({});
  
  const { data: eventTypes = [], isLoading } = useQuery<EventType[]>({
    queryKey: ["/api/event-types"],
  });

  const { data: categories = [] } = useQuery<EventCategory[]>({
    queryKey: ["/api/event-categories"],
  });

  const selectedCategory = categories.find(c => c.id === formCategory);
  const typeConfigOptions = selectedCategory?.configOptions.filter(
    opt => opt.scope === "type" || opt.scope === "both"
  ) || [];

  const addForm = useForm<InsertEventType>({
    resolver: zodResolver(insertEventTypeSchema),
    defaultValues: {
      name: "",
      siriusId: "",
      description: "",
      category: "public",
    },
  });

  const editForm = useForm<InsertEventType>({
    resolver: zodResolver(insertEventTypeSchema),
    defaultValues: {
      name: "",
      siriusId: "",
      description: "",
      category: "public",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertEventType) => {
      return apiRequest("POST", "/api/event-types", {
        ...data,
        category: formCategory,
        config: Object.keys(formConfig).length > 0 ? formConfig : null,
        data: { icon: formIcon }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/event-types"] });
      setIsAddDialogOpen(false);
      addForm.reset();
      setFormIcon("Calendar");
      setFormCategory("public");
      setFormConfig({});
      toast({
        title: "Success",
        description: "Event type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create event type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: InsertEventType }) => {
      return apiRequest("PUT", `/api/event-types/${data.id}`, {
        ...data.updates,
        category: formCategory,
        config: Object.keys(formConfig).length > 0 ? formConfig : null,
        data: { icon: formIcon }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/event-types"] });
      setEditingId(null);
      editForm.reset();
      setFormIcon("Calendar");
      setFormCategory("public");
      setFormConfig({});
      toast({
        title: "Success",
        description: "Event type updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update event type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/event-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/event-types"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Event type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete event type.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (type: EventType) => {
    setEditingId(type.id);
    const data = type.data as { icon?: string } | null;
    setFormIcon(data?.icon || "Calendar");
    setFormCategory(type.category || "public");
    setFormConfig((type.config as Record<string, any>) || {});
    editForm.reset({
      name: type.name,
      siriusId: type.siriusId,
      description: type.description || "",
      category: type.category || "public",
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormIcon("Calendar");
    setFormCategory("public");
    setFormConfig({});
    editForm.reset();
  };

  const renderConfigOptions = () => {
    if (typeConfigOptions.length === 0) return null;
    
    return (
      <div className="space-y-3 border-t pt-4 mt-4">
        <Label className="text-sm font-medium">Type Configuration</Label>
        {typeConfigOptions.map((opt) => (
          <div key={opt.key} className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Label className="text-sm">{opt.label}</Label>
              {opt.description && (
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              )}
            </div>
            {opt.type === "boolean" ? (
              <Switch
                checked={formConfig[opt.key] ?? opt.defaultValue ?? false}
                onCheckedChange={(checked) => 
                  setFormConfig(prev => ({ ...prev, [opt.key]: checked }))
                }
                data-testid={`switch-config-${opt.key}`}
              />
            ) : opt.type === "number" ? (
              <Input
                type="number"
                className="w-24"
                value={formConfig[opt.key] ?? opt.defaultValue ?? ""}
                onChange={(e) => 
                  setFormConfig(prev => ({ 
                    ...prev, 
                    [opt.key]: e.target.value ? Number(e.target.value) : undefined 
                  }))
                }
                data-testid={`input-config-${opt.key}`}
              />
            ) : (
              <Input
                className="w-48"
                value={formConfig[opt.key] ?? opt.defaultValue ?? ""}
                onChange={(e) => 
                  setFormConfig(prev => ({ ...prev, [opt.key]: e.target.value }))
                }
                data-testid={`input-config-${opt.key}`}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  const onAddSubmit = (data: InsertEventType) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: InsertEventType) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, updates: data });
    }
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
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle data-testid="title-page">Event Types</CardTitle>
              <CardDescription>
                Manage event types for categorizing in-person and virtual events
              </CardDescription>
            </div>
            <Button data-testid="button-add" onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Type
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {eventTypes.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-state">
              No event types configured yet. Click "Add Type" to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Icon</TableHead>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventTypes.map((type) => (
                  <TableRow key={type.id} data-testid={`row-type-${type.id}`}>
                    {editingId === type.id ? (
                      <>
                        <TableCell colSpan={6}>
                          <Form {...editForm}>
                            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                              <div className="grid grid-cols-4 gap-4">
                                <div className="space-y-2">
                                  <Label>Icon</Label>
                                  <Select value={formIcon} onValueChange={setFormIcon}>
                                    <SelectTrigger data-testid={`select-edit-icon-${type.id}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {availableIcons.map(({ name, Icon }) => (
                                        <SelectItem key={name} value={name}>
                                          <div className="flex items-center gap-2">
                                            <Icon size={16} />
                                            <span>{name}</span>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <FormField
                                  control={editForm.control}
                                  name="siriusId"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Sirius ID *</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder="e.g., CONFERENCE"
                                          data-testid="input-edit-siriusId"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={editForm.control}
                                  name="name"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Name *</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder="e.g., Conference"
                                          data-testid="input-edit-name"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <div className="space-y-2">
                                  <Label>Category *</Label>
                                  <Select value={formCategory} onValueChange={setFormCategory}>
                                    <SelectTrigger data-testid={`select-edit-category-${type.id}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {categories.map((cat) => (
                                        <SelectItem key={cat.id} value={cat.id}>
                                          {cat.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <FormField
                                control={editForm.control}
                                name="description"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                      <Textarea
                                        placeholder="Optional description"
                                        rows={2}
                                        data-testid="input-edit-description"
                                        {...field}
                                        value={field.value || ""}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              {renderConfigOptions()}
                              <div className="flex gap-2">
                                <Button
                                  type="submit"
                                  size="sm"
                                  data-testid="button-save"
                                  disabled={updateMutation.isPending}
                                >
                                  {updateMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <Save className="h-4 w-4 mr-2" />
                                      Save
                                    </>
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={handleCancelEdit}
                                  data-testid="button-cancel"
                                >
                                  <X className="h-4 w-4 mr-2" />
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          </Form>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell data-testid={`icon-${type.id}`}>
                          {(() => {
                            const data = type.data as { icon?: string } | null;
                            const selectedIcon = availableIcons.find(i => i.name === data?.icon);
                            const IconComponent = selectedIcon?.Icon || Calendar;
                            return <IconComponent size={20} className="text-muted-foreground" />;
                          })()}
                        </TableCell>
                        <TableCell data-testid={`text-siriusId-${type.id}`}>{type.siriusId}</TableCell>
                        <TableCell data-testid={`text-name-${type.id}`}>{type.name}</TableCell>
                        <TableCell data-testid={`text-category-${type.id}`}>
                          {(() => {
                            const cat = categories.find(c => c.id === type.category);
                            return cat ? (
                              <Badge variant="outline">{cat.label}</Badge>
                            ) : (
                              <span className="text-muted-foreground">{type.category || "-"}</span>
                            );
                          })()}
                        </TableCell>
                        <TableCell data-testid={`text-description-${type.id}`}>
                          {type.description || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            data-testid={`button-edit-${type.id}`}
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(type)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            data-testid={`button-delete-${type.id}`}
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(type.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        setIsAddDialogOpen(open);
        if (!open) {
          setFormIcon("Calendar");
          setFormCategory("public");
          setFormConfig({});
          addForm.reset();
        }
      }}>
        <DialogContent data-testid="dialog-add" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Event Type</DialogTitle>
            <DialogDescription>
              Create a new event type to categorize events.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="add-icon">Icon</Label>
                  <Select value={formIcon} onValueChange={setFormIcon}>
                    <SelectTrigger id="add-icon" data-testid="select-add-icon">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableIcons.map(({ name, Icon }) => (
                        <SelectItem key={name} value={name}>
                          <div className="flex items-center gap-2">
                            <Icon size={16} />
                            <span>{name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-category">Category *</Label>
                  <Select value={formCategory} onValueChange={setFormCategory}>
                    <SelectTrigger id="add-category" data-testid="select-add-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCategory?.description && (
                    <p className="text-xs text-muted-foreground">{selectedCategory.description}</p>
                  )}
                </div>
              </div>
              <FormField
                control={addForm.control}
                name="siriusId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sirius ID *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., CONFERENCE, WORKSHOP, WEBINAR"
                        data-testid="input-add-siriusId"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={addForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Conference, Workshop, Webinar"
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
              {renderConfigOptions()}
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

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete">
          <DialogHeader>
            <DialogTitle>Delete Event Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this event type? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="button-confirm-delete"
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
            <Button
              data-testid="button-cancel-delete"
              variant="outline"
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
