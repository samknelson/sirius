import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Award, Plus, Trash2 } from "lucide-react";
import { renderIcon } from "@/components/ui/icon-picker";
import type { WorkerSkill, OptionsSkill } from "@shared/schema";

interface WorkerSkillWithDetails extends WorkerSkill {
  skill?: OptionsSkill | null;
}

function SkillsContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('staff');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [selectedSkillToRemove, setSelectedSkillToRemove] = useState<WorkerSkillWithDetails | null>(null);
  const [formSkillId, setFormSkillId] = useState<string>("");
  const [formMessage, setFormMessage] = useState<string>("");
  const [removeMessage, setRemoveMessage] = useState<string>("");

  const { data: workerSkills = [], isLoading } = useQuery<WorkerSkillWithDetails[]>({
    queryKey: ["/api/worker-skills/worker", worker.id],
  });

  const { data: availableSkills = [] } = useQuery<OptionsSkill[]>({
    queryKey: ["/api/options/skill"],
  });

  const assignedSkillIds = new Set(workerSkills.map(ws => ws.skillId));
  const unassignedSkills = availableSkills.filter(s => !assignedSkillIds.has(s.id));

  const addMutation = useMutation({
    mutationFn: async (data: { workerId: string; skillId: string; message?: string }) => {
      return apiRequest("POST", "/api/worker-skills", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-skills/worker", worker.id] });
      toast({
        title: "Skill added",
        description: "The skill has been added to this worker.",
      });
      closeAddModal();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add skill.",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({ id, message }: { id: string; message?: string }) => {
      return apiRequest("DELETE", `/api/worker-skills/${id}`, { message });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-skills/worker", worker.id] });
      toast({
        title: "Skill removed",
        description: "The skill has been removed from this worker.",
      });
      closeRemoveModal();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove skill.",
        variant: "destructive",
      });
    },
  });

  const openAddModal = () => {
    setFormSkillId("");
    setFormMessage("");
    setIsAddModalOpen(true);
  };

  const closeAddModal = () => {
    setIsAddModalOpen(false);
    setFormSkillId("");
    setFormMessage("");
  };

  const openRemoveModal = (workerSkill: WorkerSkillWithDetails) => {
    setSelectedSkillToRemove(workerSkill);
    setRemoveMessage("");
    setIsRemoveModalOpen(true);
  };

  const closeRemoveModal = () => {
    setIsRemoveModalOpen(false);
    setSelectedSkillToRemove(null);
    setRemoveMessage("");
  };

  const handleAddSubmit = () => {
    if (!formSkillId) {
      toast({
        title: "Validation Error",
        description: "Please select a skill to add.",
        variant: "destructive",
      });
      return;
    }
    addMutation.mutate({
      workerId: worker.id,
      skillId: formSkillId,
      message: formMessage || undefined,
    });
  };

  const handleRemoveSubmit = () => {
    if (!selectedSkillToRemove) return;
    removeMutation.mutate({
      id: selectedSkillToRemove.id,
      message: removeMessage || undefined,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>Loading skills...</CardDescription>
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
            Skills
          </CardTitle>
          <CardDescription>
            Manage skills assigned to this worker
          </CardDescription>
        </div>
        {canEdit && unassignedSkills.length > 0 && (
          <Button onClick={openAddModal} size="sm" data-testid="button-add-skill">
            <Plus className="h-4 w-4 mr-2" />
            Add Skill
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {workerSkills.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Award className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No skills assigned to this worker</p>
            {canEdit && unassignedSkills.length > 0 && (
              <Button onClick={openAddModal} variant="outline" className="mt-4" data-testid="button-add-first-skill">
                <Plus className="h-4 w-4 mr-2" />
                Add First Skill
              </Button>
            )}
            {canEdit && unassignedSkills.length === 0 && availableSkills.length === 0 && (
              <p className="text-sm mt-2">No skills have been configured yet.</p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                {canEdit && <TableHead className="w-[100px]">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {workerSkills.map((ws) => (
                <TableRow key={ws.id} data-testid={`row-worker-skill-${ws.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {ws.skill && (ws.skill.data as { icon?: string } | null)?.icon && renderIcon((ws.skill.data as { icon: string }).icon, "h-4 w-4 text-muted-foreground")}
                      <span>{ws.skill?.name || "Unknown Skill"}</span>
                    </div>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openRemoveModal(ws)}
                        data-testid={`button-remove-skill-${ws.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Skill</DialogTitle>
            <DialogDescription>
              Select a skill to add to this worker
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="skill">Skill</Label>
              <Select value={formSkillId} onValueChange={setFormSkillId}>
                <SelectTrigger data-testid="select-skill">
                  <SelectValue placeholder="Select a skill" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedSkills.map((skill) => (
                    <SelectItem key={skill.id} value={skill.id} data-testid={`option-skill-${skill.id}`}>
                      <div className="flex items-center gap-2">
                        {(skill.data as { icon?: string } | null)?.icon && renderIcon((skill.data as { icon: string }).icon, "h-4 w-4")}
                        <span>{skill.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message (optional)</Label>
              <Textarea
                id="message"
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="Explain why this skill is being added..."
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
              disabled={addMutation.isPending || !formSkillId}
              data-testid="button-confirm-add"
            >
              {addMutation.isPending ? "Adding..." : "Add Skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRemoveModalOpen} onOpenChange={setIsRemoveModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Skill</DialogTitle>
            <DialogDescription>
              Remove "{selectedSkillToRemove?.skill?.name}" from this worker
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="remove-message">Message (optional)</Label>
              <Textarea
                id="remove-message"
                value={removeMessage}
                onChange={(e) => setRemoveMessage(e.target.value)}
                placeholder="Explain why this skill is being removed..."
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
              {removeMutation.isPending ? "Removing..." : "Remove Skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function WorkerSkillsPage() {
  return (
    <WorkerLayout activeTab="skills">
      <SkillsContent />
    </WorkerLayout>
  );
}
