import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { AlertCircle, FileSpreadsheet, CheckCircle2, ArrowRight } from "lucide-react";
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

export function MapStep({ wizardId, wizardType, data, onDataChange }: MapStepProps) {
  const { toast } = useToast();

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

  const columnCount = parsedData?.columnCount || 0;
  const formSchema = z.object({
    mode: z.enum(['create', 'update']),
    hasHeaders: z.boolean(),
    columnMapping: z.record(z.string(), z.string().optional())
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mode: data?.mode || 'create',
      hasHeaders: data?.hasHeaders ?? true,
      columnMapping: data?.columnMapping || {}
    },
  });

  const mode = form.watch("mode");
  const hasHeaders = form.watch("hasHeaders");
  const columnMapping = form.watch("columnMapping");

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
      const response = await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          ...data,
          mode: values.mode,
          hasHeaders: values.hasHeaders,
          columnMapping: values.columnMapping
        }
      });
      return await response.json();
    },
    onSuccess: (updatedWizard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards", wizardId] });
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
    const mappedValues = Object.values(columnMapping).filter(v => v && v !== '_unmapped');
    return mappedValues.includes(f.id);
  });
  const isMappingComplete = requiredFields.length === mappedRequiredFields.length;

  const sortedFields = [...fields].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

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
          Map columns from your uploaded file to the required feed fields
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
                      <TableHead className="w-1/4">File Column</TableHead>
                      <TableHead className="w-12 text-center"></TableHead>
                      <TableHead className="w-1/4">Feed Field</TableHead>
                      <TableHead>Preview Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: columnCount }, (_, i) => {
                      const columnName = getColumnName(i);
                      const columnKey = `col_${i}`;
                      const mappedFieldId = columnMapping[columnKey];
                      const mappedField = fields.find(f => f.id === mappedFieldId);

                      return (
                        <TableRow key={i} data-testid={`row-column-mapping-${i}`}>
                          <TableCell>
                            <div className="font-medium text-sm">{columnName}</div>
                            <div className="text-xs text-muted-foreground">
                              Column {i + 1}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <ArrowRight size={16} className="text-muted-foreground" />
                          </TableCell>
                          <TableCell>
                            <FormField
                              control={form.control}
                              name={`columnMapping.${columnKey}`}
                              render={({ field }) => (
                                <FormItem>
                                  <Select
                                    onValueChange={field.onChange}
                                    defaultValue={field.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger data-testid={`select-field-${i}`}>
                                        <SelectValue placeholder="Select field..." />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="_unmapped" data-testid="option-unmapped">
                                        (Do not map)
                                      </SelectItem>
                                      {sortedFields.map(field => {
                                        const isRequired = isFieldRequired(field, mode);
                                        return (
                                          <SelectItem key={field.id} value={field.id} data-testid={`option-field-${field.id}`}>
                                            {field.name} {isRequired && <span className="text-destructive">*</span>}
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            {mappedField && (
                              <div className="text-xs text-muted-foreground mt-1">
                                {mappedField.description}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-muted-foreground font-mono max-w-xs truncate">
                              {previewData[0]?.[i] || '-'}
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
                          {row.map((cell, cellIndex) => (
                            <TableCell key={cellIndex} className="text-xs font-mono">
                              {cell || '-'}
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
