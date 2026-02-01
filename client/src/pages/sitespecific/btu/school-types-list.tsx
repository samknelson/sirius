import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, Search, X, Building2, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface BtuSchoolType {
  id: string;
  siriusId: string;
  name: string;
}

interface FormValues {
  siriusId: string;
  name: string;
}

export default function BtuSchoolTypesListPage() {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editRecord, setEditRecord] = useState<BtuSchoolType | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: records = [], isLoading, error } = useQuery<BtuSchoolType[]>({
    queryKey: ["/api/sitespecific/btu/school-types"],
  });

  const form = useForm<FormValues>({
    defaultValues: {
      siriusId: "",
      name: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      return apiRequest("POST", "/api/sitespecific/btu/school-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/school-types"] });
      toast({
        title: "School Type Created",
        description: "The school type has been created.",
      });
      setIsAddDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Create Failed",
        description: error?.message || "Failed to create school type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormValues }) => {
      return apiRequest("PATCH", `/api/sitespecific/btu/school-types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/school-types"] });
      toast({
        title: "School Type Updated",
        description: "The school type has been updated.",
      });
      setEditRecord(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update school type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/btu/school-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/school-types"] });
      toast({
        title: "School Type Deleted",
        description: "The school type has been deleted.",
      });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error?.message || "Failed to delete school type.",
        variant: "destructive",
      });
    },
  });

  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      if (searchQuery === "") return true;
      const query = searchQuery.toLowerCase();
      return (
        record.siriusId.toLowerCase().includes(query) ||
        record.name.toLowerCase().includes(query)
      );
    });
  }, [records, searchQuery]);

  const openEditDialog = (record: BtuSchoolType) => {
    form.reset({
      siriusId: record.siriusId,
      name: record.name,
    });
    setEditRecord(record);
  };

  const onSubmit = (data: FormValues) => {
    const cleanedData = {
      siriusId: data.siriusId.trim(),
      name: data.name.trim(),
    };
    
    if (editRecord) {
      updateMutation.mutate({ id: editRecord.id, data: cleanedData });
    } else {
      createMutation.mutate(cleanedData);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <PageHeader 
          title="School Types" 
          icon={<Building2 className="text-primary-foreground" size={16} />}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <PageHeader 
          title="School Types" 
          icon={<Building2 className="text-primary-foreground" size={16} />}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="pt-6 text-center text-destructive">
              Failed to load school types. Please try again later.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="School Types" 
        icon={<Building2 className="text-primary-foreground" size={16} />}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search school types..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-search"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 px-2"
                      onClick={() => setSearchQuery("")}
                      data-testid="button-clear-search"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-school-type">
                <Plus className="h-4 w-4 mr-2" />
                Add School Type
              </Button>
            </div>
          </CardContent>
        </Card>

        {filteredRecords.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              {records.length === 0 ? "No school types found." : "No school types match your search."}
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record.id} data-testid={`row-school-type-${record.id}`}>
                    <TableCell data-testid={`text-sirius-id-${record.id}`}>
                      {record.siriusId}
                    </TableCell>
                    <TableCell data-testid={`text-name-${record.id}`}>
                      {record.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(record)}
                          data-testid={`button-edit-${record.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteId(record.id)}
                          data-testid={`button-delete-${record.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete School Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this school type? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDialogOpen || !!editRecord} onOpenChange={(open) => {
        if (!open) {
          setIsAddDialogOpen(false);
          setEditRecord(null);
          form.reset();
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editRecord ? "Edit School Type" : "New School Type"}</DialogTitle>
            <DialogDescription>
              {editRecord ? "Update the school type details." : "Create a new school type."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="siriusId"
                rules={{ required: "Sirius ID is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sirius ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., ST001" data-testid="input-sirius-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                rules={{ required: "Name is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="School type name" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => {
                  setIsAddDialogOpen(false);
                  setEditRecord(null);
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
                  {editRecord ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
