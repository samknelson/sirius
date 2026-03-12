import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { IconPicker, renderIcon } from "@/components/ui/icon-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface FieldDefinition {
  name: string;
  label: string;
  inputType: 'text' | 'textarea' | 'number' | 'select-self' | 'icon' | 'checkbox' | 'select-options' | 'color';
  required: boolean;
  placeholder?: string;
  helperText?: string;
  showInTable: boolean;
  columnHeader?: string;
  columnWidth?: string;
  dataField?: boolean;
  selectOptionsType?: string;
}

interface OptionsResourceDefinition {
  type: string;
  displayName: string;
  description?: string;
  singularName: string;
  pluralName: string;
  fields: FieldDefinition[];
  supportsSequencing: boolean;
  supportsParent: boolean;
}

interface OptionItem {
  id: string;
  name: string;
  sequence?: number;
  parent?: string | null;
  data?: Record<string, any> | null;
  [key: string]: any;
}

interface ItemWithLevel extends OptionItem {
  level: number;
}

interface GenericOptionsPageProps {
  optionsType: string;
}

function buildHierarchy(items: OptionItem[], useSequence: boolean): ItemWithLevel[] {
  const result: ItemWithLevel[] = [];
  const childrenMap = new Map<string | null, OptionItem[]>();
  
  for (const item of items) {
    const parentKey = item.parent || null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)!.push(item);
  }

  Array.from(childrenMap.values()).forEach(children => {
    if (useSequence) {
      children.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    } else {
      children.sort((a, b) => a.name.localeCompare(b.name));
    }
  });

  const processed = new Set<string>();

  function addWithChildren(item: OptionItem, level: number) {
    if (processed.has(item.id)) return;
    processed.add(item.id);
    result.push({ ...item, level });
    
    const children = childrenMap.get(item.id) || [];
    for (const child of children) {
      addWithChildren(child, level + 1);
    }
  }

  const topLevel = childrenMap.get(null) || [];
  for (const item of topLevel) {
    addWithChildren(item, 0);
  }

  for (const item of items) {
    if (!processed.has(item.id)) {
      result.push({ ...item, level: 0 });
      processed.add(item.id);
    }
  }

  return result;
}

export function GenericOptionsPage({ optionsType }: GenericOptionsPageProps) {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});

  const { data: definition, isLoading: defLoading } = useQuery<OptionsResourceDefinition>({
    queryKey: ["/api/options", optionsType, "definition"],
    queryFn: async () => {
      const response = await fetch(`/api/options/${optionsType}/definition`);
      if (!response.ok) throw new Error("Failed to fetch definition");
      return response.json();
    },
  });

  const externalOptionsTypes = useMemo(() => {
    if (!definition) return [];
    return definition.fields
      .filter(f => f.inputType === 'select-options' && f.selectOptionsType)
      .map(f => f.selectOptionsType!);
  }, [definition]);

  const { data: externalOptionsData } = useQuery<Record<string, OptionItem[]>>({
    queryKey: ["/api/options/external", ...externalOptionsTypes],
    queryFn: async () => {
      const result: Record<string, OptionItem[]> = {};
      await Promise.all(externalOptionsTypes.map(async (type) => {
        const response = await fetch(`/api/options/${type}`);
        if (response.ok) {
          result[type] = await response.json();
        }
      }));
      return result;
    },
    enabled: externalOptionsTypes.length > 0,
  });

  usePageTitle(definition?.displayName || "Options");

  const { data: items = [], isLoading: itemsLoading } = useQuery<OptionItem[]>({
    queryKey: ["/api/options", optionsType],
    enabled: !!definition,
  });

  const displayItems = useMemo(() => {
    if (definition?.supportsParent) {
      return buildHierarchy(items, definition?.supportsSequencing ?? false);
    }
    if (definition?.supportsSequencing) {
      const sorted = [...items].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      return sorted.map(item => ({ ...item, level: 0 }));
    }
    return items.map(item => ({ ...item, level: 0 }));
  }, [items, definition?.supportsParent, definition?.supportsSequencing]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const payload = preparePayload(data, definition);
      if (definition?.supportsSequencing) {
        const maxSeq = items.reduce((max, item) => Math.max(max, item.sequence ?? -1), -1);
        payload.sequence = maxSeq + 1;
      }
      return apiRequest("POST", `/api/options/${optionsType}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({ title: "Success", description: `${definition?.singularName || "Item"} created successfully.` });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create item.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any> & { id: string }) => {
      const { id, ...rest } = data;
      const payload = preparePayload(rest, definition);
      return apiRequest("PUT", `/api/options/${optionsType}/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
      setEditingId(null);
      resetForm();
      toast({ title: "Success", description: `${definition?.singularName || "Item"} updated successfully.` });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update item.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/options/${optionsType}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
      setDeleteId(null);
      toast({ title: "Success", description: `${definition?.singularName || "Item"} deleted successfully.` });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete item.", variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ id, newSequence }: { id: string; newSequence: number }) => {
      return apiRequest("PUT", `/api/options/${optionsType}/${id}`, { sequence: newSequence });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to reorder.", variant: "destructive" });
    },
  });

  function preparePayload(data: Record<string, any>, def?: OptionsResourceDefinition): Record<string, any> {
    if (!def) return data;
    
    const payload: Record<string, any> = {};
    const dataFields: Record<string, any> = {};
    
    for (const field of def.fields) {
      const value = data[field.name];
      if (field.dataField) {
        if (value !== undefined && value !== null && value !== '') {
          dataFields[field.name] = value;
        }
      } else if (field.inputType === 'select-self' && value === '_none_') {
        payload[field.name] = null;
      } else if (value !== undefined) {
        if (field.inputType === 'color') {
          payload[field.name] = value || null;
        } else {
          payload[field.name] = typeof value === 'string' ? value.trim() || null : value;
        }
      }
    }
    
    if (Object.keys(dataFields).length > 0) {
      payload.data = dataFields;
    }
    
    return payload;
  }

  function resetForm() {
    setFormData({});
  }

  function handleEdit(item: OptionItem) {
    setEditingId(item.id);
    const data: Record<string, any> = {};
    if (definition) {
      for (const field of definition.fields) {
        const rawValue = field.dataField ? item.data?.[field.name] : item[field.name];
        if (field.inputType === 'select-options') {
          data[field.name] = typeof rawValue === 'string' ? rawValue : '';
        } else {
          data[field.name] = rawValue ?? '';
        }
      }
    }
    setFormData(data);
  }

  function handleCancelEdit() {
    setEditingId(null);
    resetForm();
  }

  function handleSaveEdit() {
    if (!validateForm()) return;
    updateMutation.mutate({ id: editingId!, ...formData });
  }

  function handleCreate() {
    if (!validateForm()) return;
    createMutation.mutate(formData);
  }

  function validateForm(): boolean {
    if (!definition) return false;
    for (const field of definition.fields) {
      if (field.required) {
        const value = formData[field.name];
        if (value === undefined || value === null || value === '') {
          toast({ title: "Validation Error", description: `${field.label} is required.`, variant: "destructive" });
          return false;
        }
      }
      if (field.inputType === 'select-self' && formData[field.name] === editingId) {
        toast({ title: "Validation Error", description: `An item cannot be its own ${field.label.toLowerCase()}.`, variant: "destructive" });
        return false;
      }
    }
    return true;
  }

  function handleMoveUp(item: OptionItem, index: number) {
    if (index === 0) return;
    const prevItem = displayItems[index - 1];
    reorderMutation.mutate({ id: item.id, newSequence: (prevItem.sequence ?? 0) - 1 });
  }

  function handleMoveDown(item: OptionItem, index: number) {
    if (index === displayItems.length - 1) return;
    const nextItem = displayItems[index + 1];
    reorderMutation.mutate({ id: item.id, newSequence: (nextItem.sequence ?? 0) + 1 });
  }

  function getFieldValue(item: OptionItem, field: FieldDefinition): any {
    if (field.dataField) {
      return item.data?.[field.name];
    }
    return item[field.name];
  }

  function getParentName(parentId: string | null | undefined): string | null {
    if (!parentId) return null;
    const parent = items.find(i => i.id === parentId);
    return parent?.name || null;
  }

  function renderCellValue(item: ItemWithLevel, field: FieldDefinition): React.ReactNode {
    const value = getFieldValue(item, field);
    
    if (field.inputType === 'icon') {
      return value ? renderIcon(value, "h-5 w-5 text-muted-foreground") : <span className="text-muted-foreground italic">None</span>;
    }
    
    if (field.inputType === 'select-self') {
      const parentName = getParentName(value);
      return parentName || <span className="text-muted-foreground italic">None</span>;
    }
    
    if (field.inputType === 'checkbox') {
      return value ? "Yes" : "No";
    }
    
    if (field.inputType === 'color') {
      return value ? (
        <div className="flex items-center gap-2">
          <div 
            className="h-5 w-5 rounded border" 
            style={{ backgroundColor: value }}
            title={value}
          />
          <span className="text-xs font-mono text-muted-foreground">{value}</span>
        </div>
      ) : <span className="text-muted-foreground italic">None</span>;
    }
    
    if (field.inputType === 'select-options' && field.selectOptionsType) {
      const optionsForType = externalOptionsData?.[field.selectOptionsType] || [];
      const selectedId = typeof value === 'string' ? value : '';
      const selectedOption = optionsForType.find(o => o.id === selectedId);
      if (!selectedOption) {
        return <span className="text-muted-foreground italic">None</span>;
      }
      return selectedOption.name;
    }
    
    if (field.name === 'name' && definition?.supportsParent && item.level > 0) {
      return (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground" style={{ paddingLeft: `${item.level * 1.5}rem` }}>
            <ChevronRight className="h-4 w-4 inline" />
          </span>
          {value}
        </div>
      );
    }
    
    return value || <span className="text-muted-foreground italic">None</span>;
  }

  function renderFormField(field: FieldDefinition, isInline: boolean = false): React.ReactNode {
    const value = formData[field.name] ?? '';
    const testIdSuffix = isInline && editingId ? `-${editingId}` : '';
    
    switch (field.inputType) {
      case 'textarea':
        if (isInline) {
          return (
            <Input
              value={value}
              onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
              placeholder={field.placeholder || `${field.label} (optional)`}
              data-testid={`input-edit-${field.name}${testIdSuffix}`}
            />
          );
        }
        return (
          <Textarea
            value={value}
            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
            placeholder={field.placeholder}
            data-testid={`input-add-${field.name}`}
          />
        );
      
      case 'number':
        return (
          <Input
            type="number"
            value={value === null || value === undefined || value === '' ? '' : value}
            onChange={(e) => {
              const val = e.target.value.trim();
              setFormData({ ...formData, [field.name]: val === '' ? null : parseInt(val) });
            }}
            placeholder={field.placeholder}
            data-testid={`input-${isInline ? 'edit' : 'add'}-${field.name}${testIdSuffix}`}
          />
        );
      
      case 'checkbox':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`${field.name}-checkbox`}
              checked={!!value}
              onCheckedChange={(checked) => setFormData({ ...formData, [field.name]: checked === true })}
              data-testid={`checkbox-${isInline ? 'edit' : 'add'}-${field.name}${testIdSuffix}`}
            />
            {field.helperText && <span className="text-sm text-muted-foreground">{field.helperText}</span>}
          </div>
        );
      
      case 'icon':
        return (
          <IconPicker
            value={value || undefined}
            onChange={(icon) => setFormData({ ...formData, [field.name]: icon })}
            placeholder={field.placeholder || "Select an icon (optional)"}
            data-testid={`picker-${isInline ? 'edit' : 'add'}-${field.name}${testIdSuffix}`}
          />
        );
      
      case 'select-self':
        return (
          <Select
            value={value || '_none_'}
            onValueChange={(v) => setFormData({ ...formData, [field.name]: v === '_none_' ? null : v })}
          >
            <SelectTrigger data-testid={`select-${isInline ? 'edit' : 'add'}-${field.name}${testIdSuffix}`}>
              <SelectValue placeholder={`No ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none_">No {field.label.toLowerCase()}</SelectItem>
              {items.filter(i => i.id !== editingId).map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      
      case 'select-options': {
        if (!field.selectOptionsType) return null;
        const optionsForType = externalOptionsData?.[field.selectOptionsType] || [];
        const selectedValue = typeof value === 'string' ? value : '';
        
        return (
          <Select
            value={selectedValue}
            onValueChange={(newValue) => setFormData({ ...formData, [field.name]: newValue })}
          >
            <SelectTrigger data-testid={`select-${field.name}${testIdSuffix}`}>
              <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {optionsForType.map((option) => (
                <SelectItem key={option.id} value={option.id} data-testid={`select-item-${field.name}-${option.id}`}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      
      case 'color':
        return (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value || '#6b7280'}
              onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
              className="h-9 w-12 rounded border cursor-pointer"
              data-testid={`color-${isInline ? 'edit' : 'add'}-${field.name}${testIdSuffix}`}
            />
            <Input
              value={value || '#6b7280'}
              onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
              placeholder="#6b7280"
              className="w-28 font-mono text-sm"
              data-testid={`input-${isInline ? 'edit' : 'add'}-${field.name}${testIdSuffix}`}
            />
          </div>
        );
      
      case 'text':
      default:
        return (
          <Input
            value={value}
            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
            placeholder={field.placeholder}
            data-testid={`input-${isInline ? 'edit' : 'add'}-${field.name}${testIdSuffix}`}
          />
        );
    }
  }

  if (defLoading || itemsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (!definition) {
    return (
      <div className="container mx-auto py-8 max-w-6xl">
        <div className="text-center text-muted-foreground">Unknown options type: {optionsType}</div>
      </div>
    );
  }

  const tableFields = definition.fields.filter(f => f.showInTable);

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <div className="flex justify-between items-center mb-6 gap-4 flex-wrap">
        <h1 className="text-3xl font-bold" data-testid={`heading-${optionsType}-options`}>
          {definition.displayName}
        </h1>
        <Button onClick={() => { resetForm(); setIsAddDialogOpen(true); }} data-testid={`button-add-${optionsType}-option`}>
          <Plus className="mr-2 h-4 w-4" />
          Add {definition.singularName}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{definition.displayName} Management</CardTitle>
          {definition.description && <CardDescription>{definition.description}</CardDescription>}
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid={`text-no-${optionsType}s`}>
              No {definition.pluralName.toLowerCase()} configured yet. Click "Add {definition.singularName}" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {tableFields.map((field) => (
                    <TableHead key={field.name} style={field.columnWidth ? { width: field.columnWidth } : undefined}>
                      {field.columnHeader || field.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.map((item, index) => (
                  <TableRow key={item.id} data-testid={`row-${optionsType}-option-${item.id}`}>
                    {tableFields.map((field) => (
                      <TableCell key={field.name} data-testid={`${field.name}-${item.id}`}>
                        {editingId === item.id ? renderFormField(field, true) : renderCellValue(item, field)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      {editingId === item.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" onClick={handleSaveEdit} disabled={updateMutation.isPending} data-testid={`button-save-${item.id}`}>
                            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleCancelEdit} data-testid={`button-cancel-edit-${item.id}`}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          {definition.supportsSequencing && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => handleMoveUp(item, index)} disabled={index === 0 || reorderMutation.isPending} data-testid={`button-move-up-${item.id}`}>
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => handleMoveDown(item, index)} disabled={index === displayItems.length - 1 || reorderMutation.isPending} data-testid={`button-move-down-${item.id}`}>
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="outline" onClick={() => handleEdit(item)} data-testid={`button-edit-${item.id}`}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => setDeleteId(item.id)} data-testid={`button-delete-${item.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent data-testid={`dialog-add-${optionsType}-option`}>
          <DialogHeader>
            <DialogTitle>Add {definition.singularName}</DialogTitle>
            {definition.description && <DialogDescription>{definition.description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-4 py-4">
            {definition.fields.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={`add-${field.name}`}>{field.label}{field.required && ' *'}</Label>
                {renderFormField(field, false)}
                {field.helperText && field.inputType !== 'checkbox' && (
                  <p className="text-sm text-muted-foreground">{field.helperText}</p>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsAddDialogOpen(false); resetForm(); }} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-add">
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add {definition.singularName}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete {definition.singularName}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {definition.singularName.toLowerCase()}? This action cannot be undone.
              {definition.supportsParent && " Child items will become top-level items."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteId && deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending} data-testid="button-confirm-delete">
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default GenericOptionsPage;
