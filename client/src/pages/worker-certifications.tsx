import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Award, Plus, Trash2, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { WorkerCertification, OptionsCertification } from "@shared/schema";

interface WorkerCertificationWithDetails extends WorkerCertification {
  certification?: OptionsCertification | null;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  granted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  revoked: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  expired: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

function CertificationsContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('staff');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [selectedCertToRemove, setSelectedCertToRemove] = useState<WorkerCertificationWithDetails | null>(null);
  const [formCertificationId, setFormCertificationId] = useState<string>("");
  const [formStartDate, setFormStartDate] = useState<string>("");
  const [formEndDate, setFormEndDate] = useState<string>("");
  const [formStatus, setFormStatus] = useState<string>("pending");
  const [formMessage, setFormMessage] = useState<string>("");
  const [removeMessage, setRemoveMessage] = useState<string>("");

  const { data: workerCertifications = [], isLoading } = useQuery<WorkerCertificationWithDetails[]>({
    queryKey: ["/api/worker-certifications/worker", worker.id],
  });

  const { data: availableCertifications = [] } = useQuery<OptionsCertification[]>({
    queryKey: ["/api/options/certification"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: { 
      workerId: string; 
      certificationId: string; 
      startDate?: string | null;
      endDate?: string | null;
      status?: string;
      message?: string 
    }) => {
      return apiRequest("POST", "/api/worker-certifications", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-certifications/worker", worker.id] });
      toast({
        title: "Certification added",
        description: "The certification has been added to this worker.",
      });
      closeAddModal();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add certification.",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({ id, message }: { id: string; message?: string }) => {
      return apiRequest("DELETE", `/api/worker-certifications/${id}`, { message });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-certifications/worker", worker.id] });
      toast({
        title: "Certification removed",
        description: "The certification has been removed from this worker.",
      });
      closeRemoveModal();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove certification.",
        variant: "destructive",
      });
    },
  });

  const openAddModal = () => {
    setFormCertificationId("");
    setFormStartDate("");
    setFormEndDate("");
    setFormStatus("pending");
    setFormMessage("");
    setIsAddModalOpen(true);
  };

  const closeAddModal = () => {
    setIsAddModalOpen(false);
    setFormCertificationId("");
    setFormStartDate("");
    setFormEndDate("");
    setFormStatus("pending");
    setFormMessage("");
  };

  const openRemoveModal = (cert: WorkerCertificationWithDetails) => {
    setSelectedCertToRemove(cert);
    setRemoveMessage("");
    setIsRemoveModalOpen(true);
  };

  const closeRemoveModal = () => {
    setIsRemoveModalOpen(false);
    setSelectedCertToRemove(null);
    setRemoveMessage("");
  };

  const handleAddSubmit = () => {
    if (!formCertificationId) {
      toast({
        title: "Validation Error",
        description: "Please select a certification to add.",
        variant: "destructive",
      });
      return;
    }
    addMutation.mutate({
      workerId: worker.id,
      certificationId: formCertificationId,
      startDate: formStartDate || null,
      endDate: formEndDate || null,
      status: formStatus,
      message: formMessage || undefined,
    });
  };

  const handleRemoveSubmit = () => {
    if (!selectedCertToRemove) return;
    removeMutation.mutate({
      id: selectedCertToRemove.id,
      message: removeMessage || undefined,
    });
  };

  const formatDate = (date: string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Certifications</CardTitle>
          <CardDescription>Loading certifications...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            Certifications
          </CardTitle>
          <CardDescription>
            Manage certifications assigned to this worker
          </CardDescription>
        </div>
        {canEdit && availableCertifications.length > 0 && (
          <Button onClick={openAddModal} size="sm" data-testid="button-add-certification">
            <Plus className="h-4 w-4 mr-2" />
            Add Certification
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {workerCertifications.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Award className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No certifications assigned to this worker</p>
            {canEdit && availableCertifications.length > 0 && (
              <Button onClick={openAddModal} variant="outline" className="mt-4" data-testid="button-add-first-certification">
                <Plus className="h-4 w-4 mr-2" />
                Add First Certification
              </Button>
            )}
            {canEdit && availableCertifications.length === 0 && (
              <p className="text-sm mt-2">No certifications have been configured yet.</p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Certification</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workerCertifications.map((cert) => (
                <TableRow key={cert.id} data-testid={`row-worker-certification-${cert.id}`}>
                  <TableCell>
                    <Link href={`/worker-certification/${cert.id}`} className="flex items-center gap-2 hover:underline text-primary">
                      <span>{cert.certification?.name || "Unknown Certification"}</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[cert.status] || ""} data-testid={`badge-status-${cert.id}`}>
                      {cert.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(cert.startDate)}</TableCell>
                  <TableCell>{formatDate(cert.endDate)}</TableCell>
                  <TableCell>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openRemoveModal(cert)}
                        data-testid={`button-remove-certification-${cert.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Certification</DialogTitle>
            <DialogDescription>
              Select a certification to add to this worker
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="certification">Certification</Label>
              <Select value={formCertificationId} onValueChange={setFormCertificationId}>
                <SelectTrigger data-testid="select-certification">
                  <SelectValue placeholder="Select a certification" />
                </SelectTrigger>
                <SelectContent>
                  {availableCertifications.map((cert) => (
                    <SelectItem key={cert.id} value={cert.id} data-testid={`option-certification-${cert.id}`}>
                      {cert.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                  data-testid="input-start-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  data-testid="input-end-date"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={formStatus} onValueChange={setFormStatus}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="granted">Granted</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message (optional)</Label>
              <Textarea
                id="message"
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="Explain why this certification is being added..."
                className="resize-none"
                data-testid="input-add-message"
              />
              <p className="text-xs text-muted-foreground">
                This message will be included in the log entry
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAddModal} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button 
              onClick={handleAddSubmit} 
              disabled={addMutation.isPending || !formCertificationId}
              data-testid="button-confirm-add"
            >
              {addMutation.isPending ? "Adding..." : "Add Certification"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRemoveModalOpen} onOpenChange={setIsRemoveModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Certification</DialogTitle>
            <DialogDescription>
              Remove "{selectedCertToRemove?.certification?.name}" from this worker
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="remove-message">Message (optional)</Label>
              <Textarea
                id="remove-message"
                value={removeMessage}
                onChange={(e) => setRemoveMessage(e.target.value)}
                placeholder="Explain why this certification is being removed..."
                className="resize-none"
                data-testid="input-remove-message"
              />
              <p className="text-xs text-muted-foreground">
                This message will be included in the log entry
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRemoveModal} data-testid="button-cancel-remove">
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleRemoveSubmit} 
              disabled={removeMutation.isPending}
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? "Removing..." : "Remove Certification"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function WorkerCertificationsPage() {
  return (
    <WorkerLayout activeTab="certifications">
      <CertificationsContent />
    </WorkerLayout>
  );
}
