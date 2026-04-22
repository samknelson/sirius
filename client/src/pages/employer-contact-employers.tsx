import { useState, useMemo } from "react";
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
import { Building2, Plus, Trash2, ExternalLink, Loader2, Search } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import type { Company } from "@shared/schema/employer/company-schema";

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
  companyId?: string | null;
  companyName?: string | null;
}

interface ContactTypeOption {
  id: string;
  name: string;
  description: string | null;
}

function EmployerContactEmployersContent() {
  const { employerContact } = useEmployerContactLayout();
  const { toast } = useToast();
  const { hasComponent } = useAuth();
  const showCompany = hasComponent("employer.company");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedEmployerIds, setSelectedEmployerIds] = useState<Set<string>>(new Set());
  const [selectedContactTypeId, setSelectedContactTypeId] = useState<string>("none");
  const [employerSearch, setEmployerSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  const { data: employerLinks = [], isLoading } = useQuery<EmployerLink[]>({
    queryKey: ["/api/employer-contacts", employerContact.id, "employers"],
  });

  const { data: allEmployers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: companiesList = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: showCompany,
  });

  const { data: contactTypes = [] } = useQuery<ContactTypeOption[]>({
    queryKey: ["/api/options/employer-contact-type"],
  });

  const linkedEmployerIds = employerLinks.map(l => l.employerId);
  const availableEmployers = useMemo(
    () => allEmployers.filter(e => e.isActive && !linkedEmployerIds.includes(e.id)),
    [allEmployers, linkedEmployerIds.join(",")],
  );

  const filteredEmployers = useMemo(() => {
    const q = employerSearch.trim().toLowerCase();
    return availableEmployers.filter(e => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (showCompany && companyFilter !== "all") {
        if (companyFilter === "none") {
          if (e.companyId) return false;
        } else if (e.companyId !== companyFilter) {
          return false;
        }
      }
      return true;
    });
  }, [availableEmployers, employerSearch, showCompany, companyFilter]);

  const resetDialog = () => {
    setSelectedEmployerIds(new Set());
    setSelectedContactTypeId("none");
    setEmployerSearch("");
    setCompanyFilter("all");
  };

  const linkMutation = useMutation({
    mutationFn: async (data: { employerIds: string[]; contactTypeId: string | null }) => {
      const results = await Promise.allSettled(
        data.employerIds.map(employerId =>
          apiRequest("POST", `/api/employer-contacts/${employerContact.id}/employers`, {
            employerId,
            contactTypeId: data.contactTypeId,
          }),
        ),
      );
      const failures = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
      return { total: data.employerIds.length, failures };
    },
    onSuccess: ({ total, failures }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employer-contacts", employerContact.id, "employers"] });
      const succeeded = total - failures.length;
      if (failures.length === 0) {
        toast({
          title: "Success",
          description: `Contact linked to ${succeeded} employer${succeeded === 1 ? "" : "s"}`,
        });
        setAddDialogOpen(false);
        resetDialog();
      } else if (succeeded === 0) {
        toast({
          title: "Error",
          description: failures[0]?.reason?.message ?? "Failed to link any employers",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Partially completed",
          description: `Linked ${succeeded} of ${total}. ${failures.length} failed.`,
          variant: "destructive",
        });
        setAddDialogOpen(false);
        resetDialog();
      }
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
    if (selectedEmployerIds.size === 0) return;
    linkMutation.mutate({
      employerIds: Array.from(selectedEmployerIds),
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
            <Dialog
              open={addDialogOpen}
              onOpenChange={(open) => {
                setAddDialogOpen(open);
                if (!open) resetDialog();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-employer-link">
                  <Plus size={16} className="mr-2" />
                  Add to Employer
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add to Employer</DialogTitle>
                  <DialogDescription>
                    Associate this contact with one or more employers
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Employers</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                        <Input
                          type="text"
                          placeholder="Search employers..."
                          value={employerSearch}
                          onChange={(e) => setEmployerSearch(e.target.value)}
                          className="pl-9"
                          data-testid="input-employer-search"
                        />
                      </div>
                      {showCompany && (
                        <Select value={companyFilter} onValueChange={setCompanyFilter}>
                          <SelectTrigger className="sm:w-48" data-testid="select-company-filter">
                            <SelectValue placeholder="All companies" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All companies</SelectItem>
                            <SelectItem value="none">No company</SelectItem>
                            {companiesList.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span data-testid="text-employer-selected-count">
                        {selectedEmployerIds.size} selected
                      </span>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="hover:underline disabled:opacity-50"
                          disabled={filteredEmployers.length === 0}
                          onClick={() => {
                            setSelectedEmployerIds((prev) => {
                              const next = new Set(prev);
                              filteredEmployers.forEach((e) => next.add(e.id));
                              return next;
                            });
                          }}
                          data-testid="button-select-all-visible"
                        >
                          Select all visible
                        </button>
                        <button
                          type="button"
                          className="hover:underline disabled:opacity-50"
                          disabled={selectedEmployerIds.size === 0}
                          onClick={() => setSelectedEmployerIds(new Set())}
                          data-testid="button-clear-selection"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div
                      className="max-h-64 overflow-y-auto rounded-md border divide-y"
                      data-testid="list-employers"
                    >
                      {filteredEmployers.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                          {availableEmployers.length === 0
                            ? "No available employers"
                            : "No employers match your filters"}
                        </div>
                      ) : (
                        filteredEmployers.map((emp) => {
                          const checked = selectedEmployerIds.has(emp.id);
                          return (
                            <label
                              key={emp.id}
                              className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
                              data-testid={`row-employer-option-${emp.id}`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(value) => {
                                  setSelectedEmployerIds((prev) => {
                                    const next = new Set(prev);
                                    if (value) next.add(emp.id);
                                    else next.delete(emp.id);
                                    return next;
                                  });
                                }}
                                data-testid={`checkbox-employer-${emp.id}`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{emp.name}</div>
                                {showCompany && emp.companyName && (
                                  <div className="truncate text-xs text-muted-foreground">
                                    {emp.companyName}
                                  </div>
                                )}
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>
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
                    disabled={selectedEmployerIds.size === 0 || linkMutation.isPending}
                    data-testid="button-confirm-add-employer"
                  >
                    {linkMutation.isPending && <Loader2 size={16} className="mr-2 animate-spin" />}
                    {selectedEmployerIds.size > 1
                      ? `Add ${selectedEmployerIds.size}`
                      : "Add"}
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
                        {!isCurrent && employerLinks.length > 1 && (
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
