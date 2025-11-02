import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Worker } from "@shared/schema";

interface EditWorkerNameModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: Worker | null;
  contactName: string;
}

export function EditWorkerNameModal({ open, onOpenChange, worker, contactName }: EditWorkerNameModalProps) {
  const [name, setName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateWorkerNameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      return apiRequest("PUT", `/api/workers/${id}`, { name });
    },
    onSuccess: (_, variables) => {
      // Invalidate worker queries and contact queries
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers", variables.id] });
      if (worker?.contactId) {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts", worker.contactId] });
      }
      onOpenChange(false);
      toast({
        title: "Success",
        description: "Name updated successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update name. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Initialize name when modal opens with contact display name
  useEffect(() => {
    if (contactName && open) {
      setName(contactName);
    }
  }, [contactName, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (worker && name.trim()) {
      updateWorkerNameMutation.mutate({ id: worker.id, name: name.trim() });
    }
  };

  const handleCancel = () => {
    setName(contactName || "");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Worker Name</DialogTitle>
          <DialogDescription>
            Update the worker's name below. This change will be reflected throughout the system.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="col-span-3"
                placeholder="Enter worker name"
                autoFocus
                data-testid="input-worker-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={updateWorkerNameMutation.isPending}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateWorkerNameMutation.isPending || !name.trim()}
              data-testid="button-save-edit"
            >
              {updateWorkerNameMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}