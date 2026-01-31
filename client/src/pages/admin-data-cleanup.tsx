import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, AlertTriangle, Eye, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CleanupCategory {
  id: string;
  label: string;
  dependencies: string[];
}

interface TableCount {
  name: string;
  count: number;
}

interface CategoryPreview {
  category: string;
  tables: TableCount[];
  totalRecords: number;
}

interface CleanupResult {
  category: string;
  deletedRecords: number;
}

export default function AdminDataCleanup() {
  const { toast } = useToast();
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [previewData, setPreviewData] = useState<CategoryPreview[] | null>(null);

  const { data: categories = [], isLoading } = useQuery<CleanupCategory[]>({
    queryKey: ["/api/admin/data-cleanup/categories"],
  });

  const previewMutation = useMutation({
    mutationFn: async (cats: string[]) => {
      return await apiRequest("POST", "/api/admin/data-cleanup/preview", { categories: cats });
    },
    onSuccess: (data: CategoryPreview[]) => {
      setPreviewData(data);
      setShowPreview(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Preview Failed",
        description: error.message || "Failed to preview cleanup",
        variant: "destructive",
      });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (cats: string[]) => {
      return await apiRequest("POST", "/api/admin/data-cleanup/execute", {
        categories: cats,
        confirmed: true,
      });
    },
    onSuccess: (data: { success: boolean; results: CleanupResult[]; message: string }) => {
      setShowConfirmDialog(false);
      setShowPreview(false);
      setSelectedCategories(new Set());
      setPreviewData(null);
      toast({
        title: "Cleanup Successful",
        description: data.message,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Cleanup Failed",
        description: error.message || "Failed to execute cleanup",
        variant: "destructive",
      });
    },
  });

  const toggleCategory = (categoryId: string) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(categoryId)) {
      newSelected.delete(categoryId);
    } else {
      newSelected.add(categoryId);
    }
    setSelectedCategories(newSelected);
    setShowPreview(false);
    setPreviewData(null);
  };

  const handlePreview = () => {
    if (selectedCategories.size === 0) {
      toast({
        title: "No Categories Selected",
        description: "Please select at least one category to clean up.",
        variant: "destructive",
      });
      return;
    }
    previewMutation.mutate(Array.from(selectedCategories));
  };

  const handleExecute = () => {
    executeMutation.mutate(Array.from(selectedCategories));
  };

  const getTotalRecordsToDelete = () => {
    if (!previewData) return 0;
    return previewData.reduce((sum, cat) => sum + cat.totalRecords, 0);
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-10 w-64 mb-8" />
        <div className="grid gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Data Cleanup</h1>
        <p className="text-muted-foreground mt-2">
          Selectively delete non-configuration data from the database. Configuration settings like options, roles, and permissions are preserved.
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Select Data Categories to Delete
            </CardTitle>
            <CardDescription>
              Choose which types of data you want to remove. This operation cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-start space-x-3 p-3 rounded-lg border hover-elevate cursor-pointer"
                  onClick={() => toggleCategory(category.id)}
                  data-testid={`category-${category.id}`}
                >
                  <Checkbox
                    id={category.id}
                    checked={selectedCategories.has(category.id)}
                    onCheckedChange={() => toggleCategory(category.id)}
                    data-testid={`checkbox-${category.id}`}
                  />
                  <div className="flex-1">
                    <label
                      htmlFor={category.id}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {category.label}
                    </label>
                  </div>
                  {selectedCategories.has(category.id) && (
                    <Badge variant="destructive">Selected</Badge>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-3">
              <Button
                onClick={handlePreview}
                disabled={selectedCategories.size === 0 || previewMutation.isPending}
                variant="outline"
                data-testid="button-preview"
              >
                {previewMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4 mr-2" />
                )}
                Preview
              </Button>
              <Button
                onClick={() => setShowConfirmDialog(true)}
                disabled={selectedCategories.size === 0 || !previewData}
                variant="destructive"
                data-testid="button-delete"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected Data
              </Button>
            </div>
          </CardContent>
        </Card>

        {showPreview && previewData && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Preview: Records to be Deleted
              </CardTitle>
              <CardDescription>
                The following records will be permanently deleted. Review carefully before proceeding.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {previewData.map((categoryData) => (
                  <div key={categoryData.category}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold capitalize">{categoryData.category}</h3>
                      <Badge variant="secondary">
                        {categoryData.totalRecords.toLocaleString()} records
                      </Badge>
                    </div>
                    {categoryData.tables.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Table</TableHead>
                            <TableHead className="text-right">Records</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {categoryData.tables.map((table) => (
                            <TableRow key={table.name}>
                              <TableCell className="font-mono text-sm">{table.name}</TableCell>
                              <TableCell className="text-right">{table.count.toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-muted-foreground text-sm italic">No records to delete in this category</p>
                    )}
                  </div>
                ))}

                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Total Records to Delete:</span>
                    <Badge variant="destructive" className="text-lg px-3 py-1">
                      {getTotalRecordsToDelete().toLocaleString()}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirm Data Deletion
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                You are about to permanently delete{" "}
                <strong>{getTotalRecordsToDelete().toLocaleString()}</strong> records from the
                following categories:
              </p>
              <ul className="list-disc list-inside mt-2">
                {Array.from(selectedCategories).map((cat) => (
                  <li key={cat} className="capitalize">{cat}</li>
                ))}
              </ul>
              <p className="text-destructive font-semibold mt-4">
                This action cannot be undone!
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleExecute}
              disabled={executeMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {executeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Yes, Delete All Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
