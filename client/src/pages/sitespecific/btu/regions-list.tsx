import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Loader2, Search, X, MapPin, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface Contact {
  id: string;
  displayName: string;
}

interface BtuRegion {
  id: string;
  siriusId: string;
  name: string;
  ssContactId: string | null;
  asContactId: string | null;
  olContactId: string | null;
  ssContact?: Contact | null;
  asContact?: Contact | null;
  olContact?: Contact | null;
}

interface FormValues {
  siriusId: string;
  name: string;
  ssContactId: string;
  asContactId: string;
  olContactId: string;
}

const NONE_VALUE = "__none__";

export default function BtuRegionsListPage() {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editRecord, setEditRecord] = useState<BtuRegion | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: records = [], isLoading, error } = useQuery<BtuRegion[]>({
    queryKey: ["/api/sitespecific/btu/regions"],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const form = useForm<FormValues>({
    defaultValues: {
      siriusId: "",
      name: "",
      ssContactId: "",
      asContactId: "",
      olContactId: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      return apiRequest("POST", "/api/sitespecific/btu/regions", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/regions"] });
      toast({
        title: "Region Created",
        description: "The region has been created.",
      });
      setIsAddDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Create Failed",
        description: error?.message || "Failed to create region.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormValues }) => {
      return apiRequest("PATCH", `/api/sitespecific/btu/regions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/regions"] });
      toast({
        title: "Region Updated",
        description: "The region has been updated.",
      });
      setEditRecord(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update region.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/btu/regions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/regions"] });
      toast({
        title: "Region Deleted",
        description: "The region has been deleted.",
      });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error?.message || "Failed to delete region.",
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
        record.name.toLowerCase().includes(query) ||
        (record.ssContact?.displayName?.toLowerCase().includes(query)) ||
        (record.asContact?.displayName?.toLowerCase().includes(query)) ||
        (record.olContact?.displayName?.toLowerCase().includes(query))
      );
    });
  }, [records, searchQuery]);

  const openEditDialog = (record: BtuRegion) => {
    form.reset({
      siriusId: record.siriusId,
      name: record.name,
      ssContactId: record.ssContactId || "",
      asContactId: record.asContactId || "",
      olContactId: record.olContactId || "",
    });
    setEditRecord(record);
  };

  const onSubmit = (data: FormValues) => {
    const cleanedData = {
      siriusId: data.siriusId.trim(),
      name: data.name.trim(),
      ssContactId: data.ssContactId === NONE_VALUE ? null : (data.ssContactId || null),
      asContactId: data.asContactId === NONE_VALUE ? null : (data.asContactId || null),
      olContactId: data.olContactId === NONE_VALUE ? null : (data.olContactId || null),
    };
    
    if (editRecord) {
      updateMutation.mutate({ id: editRecord.id, data: cleanedData as FormValues });
    } else {
      createMutation.mutate(cleanedData as FormValues);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <PageHeader 
          title="Regions" 
          icon={<MapPin className="text-primary-foreground" size={16} />}
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
          title="Regions" 
          icon={<MapPin className="text-primary-foreground" size={16} />}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="pt-6 text-center text-destructive">
              Failed to load regions. Please try again later.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Regions" 
        icon={<MapPin className="text-primary-foreground" size={16} />}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search regions..."
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
              <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-region">
                <Plus className="h-4 w-4 mr-2" />
                Add Region
              </Button>
            </div>
          </CardContent>
        </Card>

        {filteredRecords.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              {records.length === 0 ? "No regions found." : "No regions match your search."}
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>School Superintendent</TableHead>
                  <TableHead>Assistant Superintendent</TableHead>
                  <TableHead>Operational Leader</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record.id} data-testid={`row-region-${record.id}`}>
                    <TableCell data-testid={`text-sirius-id-${record.id}`}>
                      {record.siriusId}
                    </TableCell>
                    <TableCell data-testid={`text-name-${record.id}`}>
                      {record.name}
                    </TableCell>
                    <TableCell data-testid={`text-ss-contact-${record.id}`}>
                      {record.ssContact?.displayName || "-"}
                    </TableCell>
                    <TableCell data-testid={`text-as-contact-${record.id}`}>
                      {record.asContact?.displayName || "-"}
                    </TableCell>
                    <TableCell data-testid={`text-ol-contact-${record.id}`}>
                      {record.olContact?.displayName || "-"}
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
            <DialogTitle>Delete Region</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this region? This action cannot be undone.
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
            <DialogTitle>{editRecord ? "Edit Region" : "New Region"}</DialogTitle>
            <DialogDescription>
              {editRecord ? "Update the region details." : "Create a new region."}
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
                      <Input {...field} placeholder="e.g., REG001" data-testid="input-sirius-id" />
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
                      <Input {...field} placeholder="Region name" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ssContactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School Superintendent (SS)</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value || NONE_VALUE}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-ss-contact">
                          <SelectValue placeholder="Select a contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>None</SelectItem>
                        {contacts.map((contact) => (
                          <SelectItem key={contact.id} value={contact.id}>
                            {contact.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="asContactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assistant Superintendent (AS)</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value || NONE_VALUE}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-as-contact">
                          <SelectValue placeholder="Select a contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>None</SelectItem>
                        {contacts.map((contact) => (
                          <SelectItem key={contact.id} value={contact.id}>
                            {contact.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="olContactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Operational Leader (OL)</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value || NONE_VALUE}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-ol-contact">
                          <SelectValue placeholder="Select a contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>None</SelectItem>
                        {contacts.map((contact) => (
                          <SelectItem key={contact.id} value={contact.id}>
                            {contact.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
