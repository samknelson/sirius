import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

interface TimelineTemplate {
  id: string;
  title: string;
  description: string | null;
}

export default function GrievanceTimelineTemplatesPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    data: templates = [],
    isLoading,
  } = useQuery<TimelineTemplate[]>({
    queryKey: ["/api/grievance-timeline-templates"],
  });

  function resetForm() {
    setTitle("");
    setDescription("");
  }

  async function handleCreate() {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiRequest("POST", "/api/grievance-timeline-templates", {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/grievance-timeline-templates"],
      });
      toast({ title: "Timeline template created" });
      resetForm();
      setAddOpen(false);
    } catch (error) {
      toast({
        title: "Could not create timeline template",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Timeline Templates</CardTitle>
            <CardDescription>
              Reusable grievance timelines that map status changes to steps and
              due dates.
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setAddOpen(true);
            }}
            data-testid="button-add-timeline-template"
          >
            <Plus size={16} className="mr-2" />
            Add Template
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : templates.length === 0 ? (
            <p
              className="text-muted-foreground text-sm py-8 text-center"
              data-testid="text-no-templates"
            >
              No timeline templates yet. Add one to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id} data-testid={`row-template-${template.id}`}>
                    <TableCell>
                      <Link
                        href={`/grievance-timeline-template/${template.id}`}
                        className="font-medium hover:underline"
                        data-testid={`link-template-${template.id}`}
                      >
                        {template.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {template.description || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Timeline Template</DialogTitle>
            <DialogDescription>
              Give the template a name. You can add steps after creating it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template-title">Title</Label>
              <Input
                id="template-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-template-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-description">Description</Label>
              <Textarea
                id="template-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="input-template-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              data-testid="button-cancel-template"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving}
              data-testid="button-save-template"
            >
              {saving ? "Saving..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
