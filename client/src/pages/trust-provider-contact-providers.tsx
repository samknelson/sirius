import { useState } from "react";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
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

interface ProviderLink {
  id: string;
  providerId: string;
  contactId: string;
  contactTypeId: string | null;
  provider: {
    id: string;
    name: string;
  };
  contactType?: {
    id: string;
    name: string;
    description: string | null;
  } | null;
}

interface Provider {
  id: string;
  name: string;
}

interface ContactTypeOption {
  id: string;
  name: string;
  description: string | null;
}

function TrustProviderContactProvidersContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedContactTypeId, setSelectedContactTypeId] = useState<string>("none");

  const { data: providerLinks = [], isLoading } = useQuery<ProviderLink[]>({
    queryKey: ["/api/trust-provider-contacts", trustProviderContact.id, "providers"],
  });

  const { data: allProviders = [] } = useQuery<Provider[]>({
    queryKey: ["/api/trust/providers"],
  });

  const { data: contactTypes = [] } = useQuery<ContactTypeOption[]>({
    queryKey: ["/api/options/trust-provider-type"],
  });

  const linkedProviderIds = providerLinks.map(l => l.providerId);
  const availableProviders = allProviders.filter(
    p => !linkedProviderIds.includes(p.id)
  );

  const linkMutation = useMutation({
    mutationFn: async (data: { providerId: string; contactTypeId: string | null }) => {
      return apiRequest("POST", `/api/trust-provider-contacts/${trustProviderContact.id}/providers`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-contacts", trustProviderContact.id, "providers"] });
      toast({ title: "Success", description: "Contact linked to provider" });
      setAddDialogOpen(false);
      setSelectedProviderId("");
      setSelectedContactTypeId("none");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      return apiRequest("DELETE", `/api/trust-provider-contacts/${trustProviderContact.id}/providers/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-contacts", trustProviderContact.id, "providers"] });
      toast({ title: "Success", description: "Provider association removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAdd = () => {
    if (!selectedProviderId) return;
    linkMutation.mutate({
      providerId: selectedProviderId,
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
                Provider Associations
              </CardTitle>
              <CardDescription>
                Providers this contact is associated with
              </CardDescription>
            </div>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-provider-link">
                  <Plus size={16} className="mr-2" />
                  Add to Provider
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add to Provider</DialogTitle>
                  <DialogDescription>
                    Associate this contact with another provider
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                      <SelectTrigger data-testid="select-provider">
                        <SelectValue placeholder="Select a provider..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableProviders.length === 0 ? (
                          <SelectItem value="_none" disabled>No available providers</SelectItem>
                        ) : (
                          availableProviders.map(prov => (
                            <SelectItem key={prov.id} value={prov.id}>{prov.name}</SelectItem>
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
                    disabled={!selectedProviderId || linkMutation.isPending}
                    data-testid="button-confirm-add-provider"
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
          ) : providerLinks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No provider associations found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Contact Type</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providerLinks.map(link => {
                  const isCurrent = link.id === trustProviderContact.id;
                  return (
                    <TableRow key={link.id} data-testid={`row-provider-${link.providerId}`}>
                      <TableCell>
                        <Link href={`/trust/provider/${link.providerId}`}>
                          <span className="flex items-center gap-2 text-primary hover:underline cursor-pointer">
                            {link.provider.name}
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
                          <span className="text-muted-foreground">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!isCurrent && providerLinks.length > 1 && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                data-testid={`button-remove-provider-${link.providerId}`}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Provider Association</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove the association between this contact and <strong>{link.provider.name}</strong>? This will not delete the contact record itself.
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

export default function TrustProviderContactProvidersPage() {
  return (
    <TrustProviderContactLayout activeTab="providers">
      <TrustProviderContactProvidersContent />
    </TrustProviderContactLayout>
  );
}
