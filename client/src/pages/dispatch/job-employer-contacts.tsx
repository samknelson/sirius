import { useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Contact as ContactIcon, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { DispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AssociationRow {
  id: string;
  jobId: string;
  contactId: string;
  contact: { id: string; displayName: string; email: string | null } | null;
}

interface AssociationsResponse {
  job: { id: string; title: string; employerId: string; employerName: string | null };
  associations: AssociationRow[];
}

interface CandidateRow {
  contactId: string;
  name: string;
  email: string | null;
  contactType: string | null;
}

function EmployerContactsContent({ jobId }: { jobId: string }) {
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState<string>("");

  const listKey = [`/api/dispatch-jobs/${jobId}/employer-contacts`];
  const candidatesKey = [`/api/dispatch-jobs/${jobId}/employer-contacts/candidates`];

  const { data, isLoading, isError } = useQuery<AssociationsResponse>({ queryKey: listKey });
  const { data: candidates } = useQuery<CandidateRow[]>({ queryKey: candidatesKey });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: listKey });
    queryClient.invalidateQueries({ queryKey: candidatesKey });
  };

  const addMutation = useMutation({
    mutationFn: async (contactId: string) =>
      apiRequest("POST", `/api/dispatch-jobs/${jobId}/employer-contacts`, { contactId }),
    onSuccess: () => {
      toast({ title: "Contact added", description: "The contact is now associated with this job." });
      setSelectedContactId("");
      invalidate();
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not add contact",
        description: getApiErrorMessage(error, "Failed to associate the contact with this job."),
        variant: "destructive",
      });
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (associationId: string) =>
      apiRequest("DELETE", `/api/dispatch-jobs/${jobId}/employer-contacts/${associationId}`),
    onSuccess: () => {
      toast({ title: "Contact removed", description: "The contact is no longer associated with this job." });
      invalidate();
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not remove contact",
        description: getApiErrorMessage(error, "Failed to remove the contact from this job."),
        variant: "destructive",
      });
      invalidate();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full" data-testid="skeleton-employer-contacts" />;
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-error">
          Unable to load employer contacts for this job.
        </CardContent>
      </Card>
    );
  }

  const associatedIds = new Set(data.associations.map((a) => a.contactId));
  const availableCandidates = (candidates ?? []).filter((c) => !associatedIds.has(c.contactId));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ContactIcon size={18} /> Employer Contacts
        </CardTitle>
        <CardDescription>
          Contacts from {data.job.employerName ?? "the employer"} associated with this job.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 max-w-sm">
            <Select value={selectedContactId} onValueChange={setSelectedContactId}>
              <SelectTrigger data-testid="select-candidate-contact">
                <SelectValue
                  placeholder={
                    availableCandidates.length === 0
                      ? "No more contacts to add"
                      : "Choose a contact to add…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableCandidates.map((c) => (
                  <SelectItem key={c.contactId} value={c.contactId} data-testid={`option-candidate-${c.contactId}`}>
                    {c.name}
                    {c.contactType ? ` — ${c.contactType}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!selectedContactId || addMutation.isPending}
            onClick={() => addMutation.mutate(selectedContactId)}
            data-testid="button-add-contact"
          >
            Add
          </Button>
        </div>

        {data.associations.length === 0 ? (
          <p className="text-muted-foreground text-center py-8" data-testid="text-no-associations">
            No contacts are associated with this job yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.associations.map((row) => (
                <TableRow key={row.id} data-testid={`row-association-${row.id}`}>
                  <TableCell data-testid={`text-contact-name-${row.id}`}>
                    {row.contact?.displayName ?? "Unknown"}
                  </TableCell>
                  <TableCell>{row.contact?.email ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(row.id)}
                      data-testid={`button-remove-${row.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Staff render inside the standard job layout (tabs, header). Employer users
 * can't fetch the staff-only job endpoint the layout uses, so they get a
 * standalone header from the associations payload instead (same pattern as
 * the T631 job interviews page).
 */
export default function DispatchJobEmployerContactsPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();

  if (hasPermission("staff")) {
    return (
      <DispatchJobLayout activeTab="dispatch-job-employer-contacts">
        <EmployerContactsContent jobId={id!} />
      </DispatchJobLayout>
    );
  }

  return <EmployerJobContacts jobId={id!} />;
}

function EmployerJobContacts({ jobId }: { jobId: string }) {
  const { data } = useQuery<AssociationsResponse>({
    queryKey: [`/api/dispatch-jobs/${jobId}/employer-contacts`],
  });
  usePageTitle(data ? `Employer Contacts — ${data.job.title}` : "Employer Contacts");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-job-title">
          {data?.job.title ?? "Dispatch Job"}
        </h1>
        {data?.job.employerName && (
          <p className="text-muted-foreground" data-testid="text-employer-name">
            {data.job.employerName}
          </p>
        )}
      </div>
      <EmployerContactsContent jobId={jobId} />
    </div>
  );
}
