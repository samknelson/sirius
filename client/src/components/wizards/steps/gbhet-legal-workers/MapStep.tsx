import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, FileSpreadsheet, CheckCircle2, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface MapStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface FileRecord {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

interface FeedField {
  id: string;
  name: string;
  type: string;
  required: boolean;
  requiredForCreate?: boolean;
  requiredForUpdate?: boolean;
  description?: string;
  format?: string;
  displayOrder?: number;
}

interface ParsedFileData {
  fileName: string;
  totalRows: number;
  previewRows: any[][];
  columnCount: number;
}

function convertOldMapping(mapping: Record<string, string>): Record<string, string> {
  const keys = Object.keys(mapping);
  const isOldFormat = keys.length > 0 && keys.every(k => k.startsWith('col_'));
  if (!isOldFormat) return mapping;
  const converted: Record<string, string> = {};
  Object.entries(mapping).forEach(([colKey, fieldId]) => {
    if (fieldId && fieldId !== '_unmapped') {
      converted[fieldId] = colKey;
    }
  });
  return converted;
}

export function MapStep({ wizardId, wizardType, data, onDataChange }: MapStepProps) {
  const { toast } = useToast();
  const [headerHash, setHeaderHash] = useState<string | undefined>();

  const { data: files = [], isLoading: filesLoading } = useQuery<FileRecord[]>({
    queryKey: ["/api/wizards", wizardId, "files"],
  });

  const { data: fields = [], isLoading: fieldsLoading } = useQuery<FeedField[]>({
    queryKey: ["/api/wizard-types", wizardType, "fields"],
  });

  const uploadedFileId = data?.uploadedFileId;
  const uploadedFile = files.find(f => f.id === uploadedFileId);

  const { data: parsedData, isLoading: parseLoading } = useQuery<ParsedFileData>({
    queryKey: ["/api/wizards", wizardId, "files", uploadedFileId, "parse"],
    enabled: !!uploadedFileId,
  });

  const { data: suggestedMappingData } = useQuery<{ mapping: any; headerHash?: string; savedAt?: string }>({
    queryKey: ["/api/wizards", wizardId, "suggested-mapping"],
    enabled: !!uploadedFileId,
  });

  const columnCount = parsedData?.columnCount || 0;
  const formSchema = z.object({
    mode: z.enum(['create', 'update']),
    hasHeaders: z.boolean(),
    columnMapping: z.record(z.string(), z.string().optional())
  });

  const existingMapping = data?.columnMapping ? convertOldMapping(data.columnMapping) : {};

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mode: data?.mode || 'create',
      hasHeaders: data?.hasHeaders ?? true,
      columnMapping: existingMapping
    },
  });

  const mode = form.watch("mode");
  const hasHeaders = form.watch("hasHeaders");
  const columnMapping = form.watch("columnMapping");

  const columnUsage = useMemo(() => {
    const usage: Record<string, string[]> = {};
    Object.entries(columnMapping).forEach(([fieldId, colKey]) => {
      if (colKey && colKey !== '_unmapped') {
        if (!usage[colKey]) {
          usage[colKey] = [];
        }
        usage[colKey].push(fieldId);
      }
    });
    return usage;
  }, [columnMapping]);

  const duplicateColumns = useMemo(() => {
    const duplicates: Set<string> = new Set();
    Object.entries(columnUsage).forEach(([colKey, fieldIds]) => {
      if (fieldIds.length > 1) {
        duplicates.add(colKey);
      }
    });
    return duplicates;
  }, [columnUsage]);

  const getRequiredFields = (currentMode: 'create' | 'update'): FeedField[] => {
    return fields.filter(f => {
      if (f.required) return true;
      if (currentMode === 'create' && f.requiredForCreate) return true;
      if (currentMode === 'update' && f.requiredForUpdate) return true;
      return false;
    });
  };

  const isFieldRequired = (field: FeedField, currentMode: 'create' | 'update'): boolean => {
    if (field.required) return true;
    if (currentMode === 'create' && field.requiredForCreate) return true;
    if (currentMode === 'update' && field.requiredForUpdate) return true;
    return false;
  };

  const updateMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const updatedWizard = await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          mode: values.mode,
          hasHeaders: values.hasHeaders,
          columnMapping: values.columnMapping
        }
      });

      if (headerHash && values.columnMapping && Object.keys(values.columnMapping).length > 0) {
        try {
          await apiRequest("POST", `/api/wizards/${wizardId}/save-mapping`, {
            headerHash,
            mapping: values.columnMapping
          });
        } catch (mappingError) {
          console.error("Failed to save mapping for future use:", mappingError);
        }
      }

      return updatedWizard;
    },
    onSuccess: (updatedWizard) => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      if (onDataChange) {
        onDataChange(updatedWizard.data);
      }
      toast({
        title: "Mapping Saved",
        description: "Column mapping has been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (suggestedMappingData?.headerHash) {
      setHeaderHash(suggestedMappingData.headerHash);
    }
    
    if (suggestedMappingData?.mapping && !data?.columnMapping) {
      const converted = convertOldMapping(suggestedMappingData.mapping);
      form.reset({
        mode: form.getValues("mode"),
        hasHeaders: form.getValues("hasHeaders"),
        columnMapping: converted
      });
      toast({
        title: "Suggested Mapping Applied",
        description: "We've applied a previously saved mapping for this file structure.",
      });
    }
  }, [suggestedMappingData, data?.columnMapping, form]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateMutation.mutate(values);
  };

  const getColumnName = (index: number): string => {
    if (hasHeaders && parsedData?.previewRows?.[0]?.[index]) {
      return String(parsedData.previewRows[0][index]);
    }
    return `Column ${index + 1}`;
  };

  const previewData = parsedData?.previewRows?.slice(hasHeaders ? 1 : 0, 6) || [];

  const requiredFields = getRequiredFields(mode);
  const mappedRequiredFields = requiredFields.filter(f => {
    const mappedCol = columnMapping[f.id];
    return mappedCol && mappedCol !== '_unmapped';
  });
  const isMappingComplete = requiredFields.length === mappedRequiredFields.length;

  const sortedFields = [...fields].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

  const getPreviewForColumn = (colKey: string | undefined): string => {
    if (!colKey || colKey === '_unmapped') return '-';
    const colIndex = parseInt(colKey.replace('col_', ''));
    if (isNaN(colIndex)) return '-';
    return previewData
      .slice(0, 3)
      .map(row => row?.[colIndex])
      .filter(val => val !== undefined && val !== '')
      .join(', ') || '-';
  };

  if (!uploadedFile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Map Columns</CardTitle>
          <CardDescription>Map file columns to feed fields</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No File Uploaded</AlertTitle>
            <AlertDescription>
              Please upload a file in the previous step before proceeding with column mapping.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (filesLoading || fieldsLoading || parseLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Map Columns</CardTitle>
          <CardDescription>Map file columns to feed fields</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading file data...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Map Columns</CardTitle>
        <CardDescription>
          Map your file columns to the required system fields
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50">
          <FileSpreadsheet size={20} className="text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium" data-testid="text-mapped-filename">{uploadedFile.fileName}</p>
            <p className="text-xs text-muted-foreground">
              {parsedData?.totalRows || 0} rows, {columnCount} columns
            </p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem className="space-y-3 p-4 border rounded-lg">
                  <FormLabel className="text-base">Feed Mode</FormLabel>
                  <FormDescription>
                    Select whether this feed will create new worker records or update existing ones
                  </FormDescription>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex flex-col space-y-2"
                    >
                      <div className="flex items-center space-x-3 space-y-0">
                        <RadioGroupItem value="create" id="mode-create" data-testid="radio-mode-create" />
                        <Label htmlFor="mode-create" className="font-normal cursor-pointer">
                          <div className="font-medium">Create New Records</div>
                          <div className="text-xs text-muted-foreground">
                            All demographic fields (name, DOB) are required
                          </div>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 space-y-0">
                        <RadioGroupItem value="update" id="mode-update" data-testid="radio-mode-update" />
                        <Label htmlFor="mode-update" className="font-normal cursor-pointer">
                          <div className="font-medium">Update Existing Records</div>
                          <div className="text-xs text-muted-foreground">
                            Only SSN, employment status, and hours are required
                          </div>
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                {isMappingComplete ? (
                  <CheckCircle2 size={20} className="text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle size={20} className="text-amber-600 dark:text-amber-400" />
                )}
                <span className="text-sm font-medium">
                  {mappedRequiredFields.length} of {requiredFields.length} required fields mapped
                </span>
              </div>
              {isMappingComplete && (
                <Badge variant="default" className="bg-green-600 dark:bg-green-700" data-testid="badge-mapping-complete">
                  Complete
                </Badge>
              )}
            </div>
            
            {duplicateColumns.size > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Duplicate Column Mappings Detected</AlertTitle>
                <AlertDescription>
                  The same file column has been mapped to multiple fields. Each file column should only be used once.
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="hasHeaders"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">First row contains headers</FormLabel>
                    <FormDescription>
                      Enable this if the first row of your file contains column names
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-has-headers"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="space-y-3">
              <h3 className="text-sm font-medium">Column Mapping</h3>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/4">System Field</TableHead>
                      <TableHead className="w-12 text-center"></TableHead>
                      <TableHead className="w-1/4">File Column</TableHead>
                      <TableHead>Preview Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedFields.map((feedField) => {
                      const required = isFieldRequired(feedField, mode);
                      const selectedCol = columnMapping[feedField.id];
                      const isMapped = selectedCol && selectedCol !== '_unmapped';
                      const isUnmappedRequired = required && !isMapped;

                      return (
                        <TableRow
                          key={feedField.id}
                          data-testid={`row-field-mapping-${feedField.id}`}
                          className={isUnmappedRequired ? "bg-amber-50 dark:bg-amber-950/30" : ""}
                        >
                          <TableCell>
                            <div className="font-medium text-sm">
                              {feedField.name}
                              {required && <span className="text-destructive ml-1">*</span>}
                              {isUnmappedRequired && (
                                <Badge variant="outline" className="ml-2 text-xs border-amber-500 text-amber-600 dark:text-amber-400">
                                  unmapped
                                </Badge>
                              )}
                            </div>
                            {feedField.description && (
                              <div className="text-xs text-muted-foreground">
                                {feedField.description}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <ArrowLeft size={16} className="text-muted-foreground" />
                          </TableCell>
                          <TableCell>
                            <FormField
                              control={form.control}
                              name={`columnMapping.${feedField.id}`}
                              render={({ field }) => (
                                <FormItem>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger data-testid={`select-column-${feedField.id}`}>
                                        <SelectValue placeholder="Select column..." />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="_unmapped" data-testid="option-unmapped">
                                        (Do not map)
                                      </SelectItem>
                                      {Array.from({ length: columnCount }, (_, i) => {
                                        const colKey = `col_${i}`;
                                        const colName = getColumnName(i);
                                        const isUsedByOtherField = columnUsage[colKey]?.some(fId => fId !== feedField.id);
                                        return (
                                          <SelectItem
                                            key={colKey}
                                            value={colKey}
                                            data-testid={`option-col-${i}`}
                                            disabled={isUsedByOtherField}
                                          >
                                            {colName}
                                            {isUsedByOtherField && <span className="text-muted-foreground text-xs"> (already mapped)</span>}
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-muted-foreground font-mono max-w-xs truncate">
                              {getPreviewForColumn(selectedCol)}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-lg">
              <strong>Required fields for {mode} mode:</strong>{' '}
              {sortedFields
                .filter(f => isFieldRequired(f, mode))
                .map(f => f.name)
                .join(', ')}
            </div>

            {previewData.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Data Preview</h3>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {Array.from({ length: columnCount }, (_, i) => (
                          <TableHead key={i} className="text-xs">
                            {getColumnName(i)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.map((row, rowIndex) => (
                        <TableRow key={rowIndex}>
                          {row.map((cell: unknown, cellIndex: number) => (
                            <TableCell key={cellIndex} className="text-xs font-mono">
                              {cell != null && cell !== '' ? String(cell) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !isMappingComplete}
                data-testid="button-save-mapping"
              >
                {updateMutation.isPending ? "Saving..." : "Save Mapping"}
              </Button>
            </div>

            {!isMappingComplete && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Incomplete Mapping</AlertTitle>
                <AlertDescription>
                  Please map all required fields before saving.
                </AlertDescription>
              </Alert>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
