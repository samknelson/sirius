import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Link } from "wouter";
import { CalendarDays, Plus, Loader2, Trash2, Pencil } from "lucide-react";
import type { BusinessCalendar, BusinessCalendarData } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function BusinessCalendarsConfigPage() {
  usePageTitle("Business Calendars");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const { data: calendars = [], isLoading } = useQuery<BusinessCalendar[]>({
    queryKey: ["/api/business-calendars"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) =>
      apiRequest("POST", "/api/business-calendars", {
        ...data,
        sources: ["weekends"],
        data: { weekends: [6, 7] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-calendars"] });
      setIsAddDialogOpen(false);
      setFormName("");
      setFormDescription("");
      toast({ title: "Success", description: "Business calendar created." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create business calendar.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/business-calendars/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-calendars"] });
      setDeleteId(null);
      toast({ title: "Success", description: "Business calendar deleted." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete business calendar.",
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    if (!formName.trim()) {
      toast({ title: "Validation Error", description: "Name is required.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      name: formName.trim(),
      description: formDescription.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="heading-business-calendars">
              Business Calendars
            </h1>
            <p className="text-muted-foreground mt-2">
              Define which days count as business days for deadline and scheduling calculations
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-business-calendar">
            <Plus className="mr-2 h-4 w-4" />
            Add Calendar
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Calendar List
            </CardTitle>
            <CardDescription>
              {calendars.length} {calendars.length === 1 ? "calendar" : "calendars"} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {calendars.length === 0 ? (
              <div className="text-center py-12">
                <CalendarDays className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium text-foreground">No business calendars</h3>
                <p className="mt-2 text-muted-foreground">Get started by creating a calendar.</p>
                <Button
                  onClick={() => setIsAddDialogOpen(true)}
                  className="mt-4"
                  data-testid="button-create-first-business-calendar"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create Calendar
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Sources</TableHead>
                    <TableHead>Sirius ID</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calendars.map((cal) => {
                    const data = (cal.data ?? {}) as BusinessCalendarData;
                    return (
                      <TableRow key={cal.id} data-testid={`row-business-calendar-${cal.id}`}>
                        <TableCell data-testid={`text-business-calendar-name-${cal.id}`}>
                          <Link href={`/config/business-calendars/${cal.id}`} className="font-medium text-primary hover:underline">
                            {cal.name}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate text-muted-foreground">
                          {cal.description || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{data.region || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(cal.sources || []).map((s) => (
                              <Badge key={s} variant="secondary" className="text-xs" data-testid={`badge-source-${cal.id}-${s}`}>
                                {s}
                              </Badge>
                            ))}
                            {(cal.sources || []).length === 0 && (
                              <span className="text-muted-foreground text-sm">none</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{cal.siriusId || "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/config/business-calendars/${cal.id}`}>
                              <Button variant="ghost" size="icon" data-testid={`button-edit-business-calendar-${cal.id}`}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteId(cal.id)}
                              data-testid={`button-delete-business-calendar-${cal.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
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

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Business Calendar</DialogTitle>
            <DialogDescription>
              Create a new calendar. Weekends (Saturday & Sunday) are enabled by default; you can
              adjust sources, region, and closures on the calendar page afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="calendar-name">Name *</Label>
              <Input
                id="calendar-name"
                placeholder="e.g., Main Office Calendar"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                data-testid="input-business-calendar-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="calendar-description">Description</Label>
              <Input
                id="calendar-description"
                placeholder="Optional description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                data-testid="input-business-calendar-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-confirm-add">
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Business Calendar</DialogTitle>
            <DialogDescription>
              Are you sure? All closed days, vacations, and forced-open days for this calendar will
              be deleted too. This action cannot be undone.
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
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
