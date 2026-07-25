import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Upload, Database, Trash2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface QuickstartMetadata {
  name: string;
  exportedAt: string;
  tableCounts: Record<string, number>;
  version: string;
}

export default function AdminQuickstarts() {
  const { toast } = useToast();
  const [exportName, setExportName] = useState("");
  const [selectedImport, setSelectedImport] = useState<string | null>(null);

  const { data: quickstarts = [], isLoading } = useQuery<QuickstartMetadata[]>({
    queryKey: ["/api/quickstarts"],
  });

  const exportMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("POST", "/api/quickstarts/export", { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickstarts"] });
      setExportName("");
      toast({
        title: "Export Successful",
        description: "Database has been exported to quickstart file.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Export Failed",
        description: getApiErrorMessage(error, "Failed to export database"),
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("POST", "/api/quickstarts/import", { name });
    },
    onSuccess: () => {
      setSelectedImport(null);
      toast({
        title: "Import Successful",
        description: "Database has been replaced with quickstart data.",
      });
      // Reload the page to reflect new data
      window.location.reload();
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: getApiErrorMessage(error, "Failed to import quickstart"),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("DELETE", `/api/quickstarts/${name}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickstarts"] });
      toast({
        title: "Deleted",
        description: "Quickstart file has been deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: getApiErrorMessage(error, "Failed to delete quickstart"),
        variant: "destructive",
      });
    },
  });

  const handleExport = () => {
    if (!exportName.trim()) {
      toast({
        title: "Invalid Name",
        description: "Please enter a name for the quickstart export.",
        variant: "destructive",
      });
      return;
    }
    exportMutation.mutate(exportName.trim());
  };

  const handleImport = () => {
    if (!selectedImport) return;
    importMutation.mutate(selectedImport);
  };

  const getTotalRecords = (tableCounts: Record<string, number>) => {
    return Object.values(tableCounts).reduce((sum, count) => sum + count, 0);
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-10 w-64 mb-8" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Database Quickstarts</h1>
        <p className="text-muted-foreground mt-2">
          Export and import database snapshots for quick setup and testing.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-8">
        {/* Export Section */}
        <Card data-testid="card-export-quickstart">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Database
            </CardTitle>
            <CardDescription>
              Save the current database state to a named quickstart file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="export-name">Quickstart Name</Label>
              <Input
                id="export-name"
                data-testid="input-export-name"
                placeholder="e.g., sample-data-v1"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                disabled={exportMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Use only letters, numbers, hyphens, and underscores.
              </p>
            </div>
            <Button
              data-testid="button-export"
              onClick={handleExport}
              disabled={exportMutation.isPending || !exportName.trim()}
              className="w-full"
            >
              {exportMutation.isPending ? "Exporting..." : "Export Database"}
            </Button>
          </CardContent>
        </Card>

        {/* Import Section */}
        <Card data-testid="card-import-quickstart">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Database
            </CardTitle>
            <CardDescription>
              Replace all database content with a quickstart file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 border border-destructive rounded-lg bg-destructive/10">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-destructive">Warning: Data Loss</p>
                  <p className="text-muted-foreground">
                    This will erase ALL current data and replace it with the selected quickstart.
                  </p>
                </div>
              </div>
            </div>
            {quickstarts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No quickstart files available. Export one first.
              </p>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    data-testid="button-show-import-dialog"
                    variant="destructive"
                    className="w-full"
                    disabled={importMutation.isPending}
                  >
                    Import Quickstart
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Select Quickstart to Import</AlertDialogTitle>
                    <AlertDialogDescription>
                      Choose a quickstart file. This will permanently delete all current data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {quickstarts.map((qs) => (
                      <button
                        key={qs.name}
                        data-testid={`button-select-import-${qs.name}`}
                        onClick={() => setSelectedImport(qs.name)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          selectedImport === qs.name
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        <div className="font-medium">{qs.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(qs.exportedAt), "MMM d, yyyy h:mm a")} •{" "}
                          {getTotalRecords(qs.tableCounts)} records
                        </div>
                      </button>
                    ))}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setSelectedImport(null)}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      data-testid="button-confirm-import"
                      onClick={handleImport}
                      disabled={!selectedImport || importMutation.isPending}
                      className="bg-destructive hover:bg-destructive/90"
                    >
                      {importMutation.isPending ? "Importing..." : "Import & Replace All Data"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Available Quickstarts Table */}
      <Card data-testid="card-quickstarts-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Available Quickstarts
          </CardTitle>
          <CardDescription>
            Manage your saved database snapshots.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {quickstarts.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No quickstart files available. Export the current database to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Exported</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Tables</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quickstarts.map((qs) => (
                  <TableRow key={qs.name} data-testid={`row-quickstart-${qs.name}`}>
                    <TableCell className="font-medium">{qs.name}</TableCell>
                    <TableCell>
                      {format(new Date(qs.exportedAt), "MMM d, yyyy h:mm a")}
                    </TableCell>
                    <TableCell>{getTotalRecords(qs.tableCounts).toLocaleString()}</TableCell>
                    <TableCell>{Object.keys(qs.tableCounts).length}</TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-delete-${qs.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Quickstart?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete the quickstart "{qs.name}"? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(qs.name)}
                              className="bg-destructive hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
