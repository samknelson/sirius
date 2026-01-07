import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, FileSpreadsheet, Building2, Calendar, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { EdlsSheet, InsertEdlsSheet } from "@shared/schema";

interface EdlsSheetWithRelations extends EdlsSheet {
  employer?: { id: string; name: string };
}

interface PaginatedEdlsSheets {
  data: EdlsSheetWithRelations[];
  total: number;
  page: number;
  limit: number;
}

interface Employer {
  id: string;
  name: string;
}

export default function EdlsSheetsPage() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newSheet, setNewSheet] = useState<Partial<InsertEdlsSheet>>({
    title: "",
    date: new Date().toISOString().split("T")[0],
    workerCount: 0,
    employerId: "",
  });

  const { data: sheetsData, isLoading } = useQuery<PaginatedEdlsSheets>({
    queryKey: ["/api/edls/sheets"],
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertEdlsSheet) => {
      return apiRequest("POST", "/api/edls/sheets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets"] });
      setIsCreateDialogOpen(false);
      setNewSheet({
        title: "",
        date: new Date().toISOString().split("T")[0],
        workerCount: 0,
        employerId: "",
      });
      toast({
        title: "Sheet Created",
        description: "The new sheet has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create sheet",
        variant: "destructive",
      });
    },
  });

  const handleCreateSheet = () => {
    if (!newSheet.title || !newSheet.employerId || !newSheet.date) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(newSheet as InsertEdlsSheet);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const sheets = sheetsData?.data || [];

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle data-testid="title-page" className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Day Labor Sheets
            </CardTitle>
            <CardDescription>
              Manage employer day labor scheduling sheets
            </CardDescription>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-sheet">
                <Plus className="h-4 w-4 mr-2" />
                New Sheet
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Sheet</DialogTitle>
                <DialogDescription>
                  Add a new day labor scheduling sheet for an employer.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="employer">Employer</Label>
                  <Select
                    value={newSheet.employerId}
                    onValueChange={(value) =>
                      setNewSheet({ ...newSheet, employerId: value })
                    }
                  >
                    <SelectTrigger data-testid="select-employer">
                      <SelectValue placeholder="Select an employer" />
                    </SelectTrigger>
                    <SelectContent>
                      {employers.map((employer) => (
                        <SelectItem key={employer.id} value={employer.id}>
                          {employer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    data-testid="input-title"
                    value={newSheet.title}
                    onChange={(e) =>
                      setNewSheet({ ...newSheet, title: e.target.value })
                    }
                    placeholder="e.g., Morning Shift - January 15"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    data-testid="input-date"
                    value={newSheet.date as string}
                    onChange={(e) =>
                      setNewSheet({ ...newSheet, date: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workerCount">Worker Count</Label>
                  <Input
                    id="workerCount"
                    type="number"
                    data-testid="input-worker-count"
                    value={newSheet.workerCount || 0}
                    onChange={(e) =>
                      setNewSheet({
                        ...newSheet,
                        workerCount: parseInt(e.target.value) || 0,
                      })
                    }
                    min={0}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateSheet}
                  disabled={createMutation.isPending}
                  data-testid="button-submit"
                >
                  {createMutation.isPending ? "Creating..." : "Create Sheet"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {sheets.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No sheets found.</p>
              <p className="text-sm">Create a new sheet to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Workers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((sheet) => (
                  <TableRow key={sheet.id} data-testid={`row-sheet-${sheet.id}`}>
                    <TableCell>
                      <Link href={`/edls/sheet/${sheet.id}`}>
                        <Button
                          variant="link"
                          className="p-0 h-auto font-medium"
                          data-testid={`link-sheet-${sheet.id}`}
                        >
                          <FileSpreadsheet className="h-4 w-4 mr-2 text-muted-foreground" />
                          {sheet.title}
                        </Button>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {sheet.employer?.name || "Unknown"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {format(new Date(sheet.date), "PPP")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {sheet.workerCount}
                      </div>
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
