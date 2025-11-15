import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertLedgerEaSchema, type SelectLedgerEa, type LedgerAccount } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, Plus, ExternalLink } from "lucide-react";
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

const formSchema = insertLedgerEaSchema.omit({ data: true });

type FormData = z.infer<typeof formSchema>;

export default function EmployerLedgerAccounts() {
  const { id: employerId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const { data: entries = [], isLoading } = useQuery<SelectLedgerEa[]>({
    queryKey: ["/api/ledger/ea/entity/employer", employerId],
  });

  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: "",
      entityType: "employer",
      entityId: employerId,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return await apiRequest("POST", "/api/ledger/ea", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/ea/entity/employer", employerId] });
      toast({
        title: "Success",
        description: "Ledger account entry created successfully",
      });
      form.reset({
        accountId: "",
        entityType: "employer",
        entityId: employerId,
      });
      setIsFormOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create ledger account entry",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/ledger/ea/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/ea/entity/employer", employerId] });
      toast({
        title: "Success",
        description: "Ledger account entry deleted successfully",
      });
      setDeleteId(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete ledger account entry",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    createMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Loading account entries...</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>Manage ledger account entries for this employer</CardDescription>
          </div>
          {isFormOpen ? (
            <Button
              onClick={() => setIsFormOpen(false)}
              data-testid="button-toggle-form"
            >
              Cancel
            </Button>
          ) : (
            <Button
              onClick={() => setIsFormOpen(true)}
              data-testid="button-toggle-form"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Entry
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isFormOpen && (
          <Card className="mb-6" data-testid="card-add-entry-form">
            <CardHeader>
              <CardTitle>Add Ledger Account Entry</CardTitle>
              <CardDescription>
                Create a new ledger account entry for this employer
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="accountId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ledger Account</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          data-testid="select-account"
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select an account" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {accounts.map((account) => (
                              <SelectItem
                                key={account.id}
                                value={account.id}
                                data-testid={`select-item-account-${account.id}`}
                              >
                                {account.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    data-testid="button-submit"
                  >
                    {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Entry
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4" data-testid="text-no-entries">
              No ledger account entries found
            </p>
            {!isFormOpen && (
              <Button onClick={() => setIsFormOpen(true)} data-testid="button-create-first">
                <Plus className="h-4 w-4 mr-2" />
                Create First Entry
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map((entry) => {
              const account = accounts.find(a => a.id === entry.accountId);
              return (
                <div
                  key={entry.id}
                  className="border rounded-lg p-4 hover:border-primary/50 transition-colors"
                  data-testid={`card-entry-${entry.id}`}
                >
                  <div className="flex items-start justify-between">
                    <Link
                      href={`/ea/${entry.id}`}
                      className="flex-1 hover:opacity-80 transition-opacity"
                      data-testid={`link-entry-${entry.id}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-foreground">
                          {account?.name || "Unknown Account"}
                        </h4>
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </div>
                      {account?.description && (
                        <p className="text-sm text-muted-foreground mt-1">{account.description}</p>
                      )}
                      {entry.data && (() => {
                        const dataString = JSON.stringify(entry.data, null, 2);
                        return (
                          <pre className="bg-muted mt-3 p-3 rounded-md overflow-x-auto text-sm">
                            <code>{dataString}</code>
                          </pre>
                        );
                      })()}
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteId(entry.id)}
                      data-testid={`button-delete-${entry.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ledger Account Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this ledger account entry? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
