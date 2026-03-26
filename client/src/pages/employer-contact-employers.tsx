import { useState } from "react";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Building2, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";

interface EmployerLink {
  id: string;
  employerId: string;
  contactId: string;
  contactTypeId: string | null;
  employer: {
    id: string;
    name: string;
    isActive: boolean;
  };
  contactType?: {
    id: string;
    name: string;
    description: string | null;
  } | null;
}

interface Employer {
  id: string;
  name: string;
  isActive: boolean;
}

interface ContactTypeOption {
  id: string;
  name: string;
  description: string | null;
}

function EmployerContactEmployersContent() {
  const { employerContact } = useEmployerContactLayout();
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>("");
  const [selectedContactTypeId, setSelectedContactTypeId] = useState<string>("none");

  const { data: employerLinks = [], isLoading } = useQuery<EmployerLink[]>({
    queryKey: ["/api/employer-contacts", employerContact.id, "employers"],
  });

  const { data: allEmployers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: contactTypes = [] } = useQuery<ContactTypeOption[]>({
    queryKey: ["/api/options/employer-contact-type"],
  });

  const linkedEmployerIds = employerLinks.map(l => l.employerId);
  const availableEmployers = allEmployers.filter(
    e => e.isActive && !linkedEmployerIds.includes(e.id)
  );

  const linkMutation = useMutation({
    mutationFn: async (data: { employerId: string; contactTypeId: string | null }) => {
      return apiRequest("POST", `/api/employer-contacts/${employerContact.id}/employers`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employer-contacts", employerContact.id, "employers"] });
      toast({ title: "Success", description: "Contact linked to employer" });
      setAddDialogOpen(false);
      setSelectedEmployerId("");
      setSelectedContactTypeId("none");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      return apiRequest("DELETE", `/api/employer-contacts/${employerContact.id}/employers/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employer-contacts", employerContact.id, "employers"] });
      toast({ title: "Success", description: "Employer association removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAdd = () => {
    if (!selectedEmployerId) return;
    linkMutation.mutate({
      employerId: selectedEmployerId,
      contactTypeId: selectedContactTypeId === "none" ? null : selectedContactTypeId,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 size={20} />
                Employer Associations
              </CardTitle>
              <CardDescription>
                Employers this contact is associated with
              </CardDescription>
            </div>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-employer-link">
                  <Plus size={16} className="mr-2" />
                  Add to Employer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add to Employer</DialogTitle>
                  <DialogDescription>
                    Associate this contact with another employer
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Employer</Label>
                    <Select value={selectedEmployerId} onValueChange={setSelectedEmployerId}>
                      <SelectTrigger data-testid="select-employer">
                        <SelectValue placeholder="Select an employer..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableEmployers.length === 0 ? (
                          <SelectItem value="_none" disabled>No available employers</SelectItem>
                        ) : (
                          availableEmployers.map(emp => (
                            <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Contact Type (optional)</Label>
                    <Select value={selectedContactTypeId} onValueChange={setSelectedContactTypeId}>
                      <SelectTrigger data-testid="select-contact-type">
                        <SelectValue placeholder="Select a contact type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {contactTypes.map(ct => (
                          <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                  <Button
                    onClick={handleAdd}
                    disabled={!selectedEmployerId || linkMutation.isPending}
                    data-testid="button-confirm-add-employer"
                  >
                    {linkMutation.isPending && <Loader2 size={16} className="mr-2 animate-spin" />}
                    Add
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-muted-foreground" size={24} />
            </div>
          ) : employerLinks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No employer associations found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employer</TableHead>
                  <TableHead>Contact Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employerLinks.map(link => {
                  const isCurrent = link.id === employerContact.id;
                  return (
                    <TableRow key={link.id} data-testid={`row-employer-${link.employerId}`}>
                      <TableCell>
                        <Link href={`/employers/${link.employerId}`}>
                          <span className="flex items-center gap-2 text-primary hover:underline cursor-pointer">
                            {link.employer.name}
                            <ExternalLink size={14} />
                          </span>
                        </Link>
                        {isCurrent && (
                          <Badge variant="secondary" className="ml-2 text-xs">Current</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {link.contactType ? (
                          <Badge variant="outline">{link.contactType.name}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={link.employer.isActive ? "default" : "secondary"}>
                          {link.employer.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {employerLinks.length > 1 && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                data-testid={`button-remove-employer-${link.employerId}`}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Employer Association</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove the association between this contact and <strong>{link.employer.name}</strong>? This will not delete the contact record itself.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => unlinkMutation.mutate(link.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployerContactEmployersPage() {
  return (
    <EmployerContactLayout activeTab="employers">
      <EmployerContactEmployersContent />
    </EmployerContactLayout>
  );
}
