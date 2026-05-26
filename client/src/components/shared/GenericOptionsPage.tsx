import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Loader2,
  Plus,
  Edit,
  Trash2,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { renderIcon } from "@/components/ui/icon-picker";
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
import { SchemaFormDialog } from "@/components/json-schema-form";
import {
  splitPayloadByDataField,
  type JsonSchema,
  type UiSchema,
} from "@shared/json-schema-form";

interface FieldDefinition {
  name: string;
  label: string;
  inputType:
    | "text"
    | "textarea"
    | "number"
    | "select-self"
    | "icon"
    | "checkbox"
    | "select-options"
    | "color"
    | "multi-enum";
  required: boolean;
  placeholder?: string;
  helperText?: string;
  showInTable: boolean;
  columnHeader?: string;
  columnWidth?: string;
  dataField?: boolean;
  selectOptionsType?: string;
  enumOptions?: Array<{ value: string; label?: string }>;
}

interface OptionsResourceDefinition {
  type: string;
  displayName: string;
  description?: string;
  singularName: string;
  pluralName: string;
  fields: FieldDefinition[];
  schema: JsonSchema;
  uiSchema: UiSchema;
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
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(item);
  }

  Array.from(childrenMap.values()).forEach((children) => {
    if (useSequence) children.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    else children.sort((a, b) => a.name.localeCompare(b.name));
  });

  const processed = new Set<string>();
  function addWithChildren(item: OptionItem, level: number) {
    if (processed.has(item.id)) return;
    processed.add(item.id);
    result.push({ ...item, level });
    const children = childrenMap.get(item.id) || [];
    for (const child of children) addWithChildren(child, level + 1);
  }
  const topLevel = childrenMap.get(null) || [];
  for (const item of topLevel) addWithChildren(item, 0);
  for (const item of items) {
    if (!processed.has(item.id)) {
      result.push({ ...item, level: 0 });
      processed.add(item.id);
    }
  }
  return result;
}

/**
 * Hydrate a row into the flat shape the form expects: top-level
 * columns + entries inside `data` are merged into the same key/value
 * map (the `x-data-field` markers in the schema let us split it back
 * out on save).
 */
function rowToFormData(
  item: OptionItem | null,
  fields: FieldDefinition[],
): Record<string, unknown> {
  if (!item) return {};
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = f.dataField ? item.data?.[f.name] : item[f.name];
    if (v === null || v === undefined) continue;
    out[f.name] = v;
  }
  return out;
}

/**
 * Take a flat form payload and split it into top-level columns + a
 * `data` JSONB blob using the schema's `x-data-field` markers.
 *
 * Behavioral parity with the old inline-edit form: optional text
 * fields cleared in the UI must be persisted as explicit `null` so the
 * server actually clears the column on update (dropping the key would
 * leave the previous value in place).
 */
function formDataToPayload(
  formData: Record<string, unknown>,
  schema: JsonSchema,
): Record<string, unknown> {
  const { columnFields, dataFields } = splitPayloadByDataField(schema, formData);
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(columnFields)) {
    if (typeof v === "string" && v.trim() === "") {
      payload[k] = null;
    } else {
      payload[k] = v;
    }
  }
  if (Object.keys(dataFields).length > 0) {
    payload.data = dataFields;
  }
  return payload;
}

export function GenericOptionsPage({ optionsType }: GenericOptionsPageProps) {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<OptionItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: definition, isLoading: defLoading } = useQuery<OptionsResourceDefinition>({
    queryKey: ["/api/options", optionsType, "definition"],
    queryFn: async () => {
      const response = await fetch(`/api/options/${optionsType}/definition`);
      if (!response.ok) throw new Error("Failed to fetch definition");
      return response.json();
    },
  });

  // External-options data is now fetched by the RemoteOptionsWidget
  // itself; we only keep a lookup map here so the table can show names
  // for select-options columns without re-fetching from inside cells.
  const externalOptionsTypes = useMemo(() => {
    if (!definition) return [];
    return definition.fields
      .filter((f) => f.inputType === "select-options" && f.selectOptionsType)
      .map((f) => f.selectOptionsType!);
  }, [definition]);

  const { data: externalOptionsData } = useQuery<Record<string, OptionItem[]>>({
    queryKey: ["/api/options/external", ...externalOptionsTypes],
    queryFn: async () => {
      const result: Record<string, OptionItem[]> = {};
      await Promise.all(
        externalOptionsTypes.map(async (type) => {
          const response = await fetch(`/api/options/${type}`);
          if (response.ok) result[type] = await response.json();
        }),
      );
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
      return sorted.map((item) => ({ ...item, level: 0 }));
    }
    return items.map((item) => ({ ...item, level: 0 }));
  }, [items, definition?.supportsParent, definition?.supportsSequencing]);

  const selfItems = useMemo(
    () => items.map((i) => ({ id: i.id, name: i.name })),
    [items],
  );

  const createMutation = useMutation({
    mutationFn: async (formData: Record<string, unknown>) => {
      if (!definition) throw new Error("Definition not loaded");
      const payload = formDataToPayload(formData, definition.schema);
      if (definition.supportsSequencing) {
        const maxSeq = items.reduce(
          (max, item) => Math.max(max, item.sequence ?? -1),
          -1,
        );
        (payload as Record<string, unknown>).sequence = maxSeq + 1;
      }
      return apiRequest("POST", `/api/options/${optionsType}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
      setIsAddOpen(false);
      toast({
        title: "Created",
        description: `New ${definition?.singularName.toLowerCase()} created.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      formData,
    }: {
      id: string;
      formData: Record<string, unknown>;
    }) => {
      if (!definition) throw new Error("Definition not loaded");
      const payload = formDataToPayload(formData, definition.schema);
      return apiRequest("PUT", `/api/options/${optionsType}/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
      setEditingItem(null);
      toast({ title: "Updated", description: "Changes saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/options/${optionsType}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
      setDeleteId(null);
      toast({ title: "Deleted", description: "Item removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ id, newSequence }: { id: string; newSequence: number }) =>
      apiRequest("PUT", `/api/options/${optionsType}/${id}`, { sequence: newSequence }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
    },
  });

  function handleMoveUp(item: OptionItem, index: number) {
    if (index === 0) return;
    const prev = displayItems[index - 1];
    reorderMutation.mutate({ id: item.id, newSequence: (prev.sequence ?? 0) - 1 });
  }
  function handleMoveDown(item: OptionItem, index: number) {
    if (index === displayItems.length - 1) return;
    const next = displayItems[index + 1];
    reorderMutation.mutate({ id: item.id, newSequence: (next.sequence ?? 0) + 1 });
  }

  function getFieldValue(item: OptionItem, field: FieldDefinition): any {
    return field.dataField ? item.data?.[field.name] : item[field.name];
  }

  function renderCell(item: ItemWithLevel, field: FieldDefinition) {
    const value = getFieldValue(item, field);

    if (field.inputType === "checkbox") {
      return value ? "Yes" : "No";
    }
    if (field.inputType === "icon") {
      return value ? renderIcon(value, "h-5 w-5") : (
        <span className="text-muted-foreground italic">None</span>
      );
    }
    if (field.inputType === "color") {
      return value ? (
        <div className="flex items-center gap-2">
          <div
            className="h-5 w-5 rounded border"
            style={{ backgroundColor: value }}
            title={value}
          />
          <span className="text-xs font-mono text-muted-foreground">{value}</span>
        </div>
      ) : (
        <span className="text-muted-foreground italic">None</span>
      );
    }
    if (field.inputType === "select-options" && field.selectOptionsType) {
      const list = externalOptionsData?.[field.selectOptionsType] || [];
      const selected = list.find((o) => o.id === (typeof value === "string" ? value : ""));
      return selected ? selected.name : (
        <span className="text-muted-foreground italic">None</span>
      );
    }
    if (field.inputType === "multi-enum") {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) {
        return <span className="text-muted-foreground italic">None</span>;
      }
      const labelMap = new Map(
        (field.enumOptions ?? []).map((o) => [o.value, o.label ?? o.value]),
      );
      return (
        <div className="flex flex-wrap gap-1">
          {arr.map((v) => (
            <span
              key={String(v)}
              className="inline-flex items-center rounded border bg-muted px-2 py-0.5 text-xs"
            >
              {labelMap.get(String(v)) ?? String(v)}
            </span>
          ))}
        </div>
      );
    }
    if (field.inputType === "select-self") {
      const parent = items.find((i) => i.id === value);
      return parent ? parent.name : (
        <span className="text-muted-foreground italic">None</span>
      );
    }
    if (field.name === "name" && definition?.supportsParent && item.level > 0) {
      return (
        <div className="flex items-center gap-1">
          <span
            className="text-muted-foreground"
            style={{ paddingLeft: `${item.level * 1.5}rem` }}
          >
            <ChevronRight className="h-4 w-4 inline" />
          </span>
          {value}
        </div>
      );
    }
    return value || <span className="text-muted-foreground italic">None</span>;
  }

  if (defLoading || !definition) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const tableFields = definition.fields.filter((f) => f.showInTable);
  const editingFormData = useMemo(
    () => rowToFormData(editingItem, definition.fields),
    [editingItem, definition.fields],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle data-testid="text-page-title">{definition.displayName}</CardTitle>
              {definition.description && (
                <CardDescription>{definition.description}</CardDescription>
              )}
            </div>
            <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-item">
              <Plus className="mr-2 h-4 w-4" />
              Add {definition.singularName}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {itemsLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : displayItems.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No {definition.pluralName.toLowerCase()} yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {tableFields.map((f) => (
                    <TableHead key={f.name} style={f.columnWidth ? { width: f.columnWidth } : undefined}>
                      {f.columnHeader || f.label}
                    </TableHead>
                  ))}
                  <TableHead className="w-[180px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.map((item, index) => (
                  <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                    {tableFields.map((f) => (
                      <TableCell key={f.name} data-testid={`cell-${f.name}-${item.id}`}>
                        {renderCell(item, f)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {definition.supportsSequencing && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleMoveUp(item, index)}
                              disabled={index === 0 || reorderMutation.isPending}
                              data-testid={`button-up-${item.id}`}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleMoveDown(item, index)}
                              disabled={
                                index === displayItems.length - 1 || reorderMutation.isPending
                              }
                              data-testid={`button-down-${item.id}`}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingItem(item)}
                          data-testid={`button-edit-${item.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteId(item.id)}
                          data-testid={`button-delete-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SchemaFormDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        title={`Add ${definition.singularName}`}
        description={definition.description}
        schema={definition.schema}
        uiSchema={definition.uiSchema}
        initialData={{}}
        formContext={{ selfItems, editingId: null }}
        onSave={(data) => createMutation.mutate(data)}
        isSaving={createMutation.isPending}
        testId="dialog-add"
      />

      <SchemaFormDialog
        open={editingItem !== null}
        onOpenChange={(open) => !open && setEditingItem(null)}
        title={`Edit ${definition.singularName}`}
        description={definition.description}
        schema={definition.schema}
        uiSchema={definition.uiSchema}
        initialData={editingFormData}
        formContext={{ selfItems, editingId: editingItem?.id ?? null }}
        onSave={(data) =>
          editingItem && updateMutation.mutate({ id: editingItem.id, formData: data })
        }
        isSaving={updateMutation.isPending}
        testId="dialog-edit"
      />

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete {definition.singularName}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {definition.singularName.toLowerCase()}?
              This action cannot be undone.
              {definition.supportsParent && " Child items will become top-level items."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteId(null)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
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
