import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  FileSpreadsheet,
  Building2,
  Calendar,
  Users,
  Edit,
  Save,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { EdlsSheet, InsertEdlsSheet } from "@shared/schema";

interface EdlsSheetWithRelations extends EdlsSheet {
  employer?: { id: string; name: string };
}

interface Employer {
  id: string;
  name: string;
}

export default function EdlsSheetViewPage() {
  const [, params] = useRoute("/edls/sheet/:id");
  const sheetId = params?.id;
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("view");
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<InsertEdlsSheet>>({});

  const { data: sheet, isLoading } = useQuery<EdlsSheetWithRelations>({
    queryKey: ["/api/edls/sheets", sheetId],
    enabled: !!sheetId,
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
    enabled: isEditing,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InsertEdlsSheet>) => {
      return apiRequest("PUT", `/api/edls/sheets/${sheetId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheetId] });
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets"] });
      setIsEditing(false);
      toast({
        title: "Sheet Updated",
        description: "The sheet has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update sheet",
        variant: "destructive",
      });
    },
  });

  const handleStartEdit = () => {
    if (sheet) {
      setEditData({
        title: sheet.title,
        date: sheet.date,
        workerCount: sheet.workerCount,
        employerId: sheet.employerId,
      });
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({});
  };

  const handleSave = () => {
    if (!editData.title || !editData.employerId || !editData.date) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate(editData);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Sheet not found.</p>
              <Link href="/edls/sheets">
                <Button variant="link" className="mt-4">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Sheets
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-4">
        <Link href="/edls/sheets">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Sheets
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle data-testid="title-page" className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {sheet.title}
            </CardTitle>
            <CardDescription className="flex items-center gap-4 mt-1">
              <span className="flex items-center gap-1">
                <Building2 className="h-4 w-4" />
                {sheet.employer?.name || "Unknown Employer"}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {format(new Date(sheet.date), "PPP")}
              </span>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="view" data-testid="tab-view">View</TabsTrigger>
              <TabsTrigger value="edit" data-testid="tab-edit">Edit</TabsTrigger>
            </TabsList>

            <TabsContent value="view">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Title</h3>
                  <p className="text-foreground" data-testid="text-title">{sheet.title}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Employer</h3>
                  <p className="text-foreground flex items-center gap-2" data-testid="text-employer">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {sheet.employer?.name || "Unknown"}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Date</h3>
                  <p className="text-foreground flex items-center gap-2" data-testid="text-date">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {format(new Date(sheet.date), "PPP")}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Worker Count</h3>
                  <p className="text-foreground flex items-center gap-2" data-testid="text-worker-count">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    {sheet.workerCount}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="edit">
              {!isEditing ? (
                <div className="text-center py-8">
                  <Button onClick={handleStartEdit} data-testid="button-start-edit">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Sheet
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-title">Title</Label>
                    <Input
                      id="edit-title"
                      data-testid="input-edit-title"
                      value={editData.title || ""}
                      onChange={(e) =>
                        setEditData({ ...editData, title: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-employer">Employer</Label>
                    <Select
                      value={editData.employerId}
                      onValueChange={(value) =>
                        setEditData({ ...editData, employerId: value })
                      }
                    >
                      <SelectTrigger data-testid="select-edit-employer">
                        <SelectValue placeholder="Select an employer" />
                      </SelectTrigger>
                      <SelectContent>
                        {employers.map((employer) => (
                          <SelectItem key={employer.id} value={employer.id}>
                            {employer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-date">Date</Label>
                    <Input
                      id="edit-date"
                      type="date"
                      data-testid="input-edit-date"
                      value={editData.date as string}
                      onChange={(e) =>
                        setEditData({ ...editData, date: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-worker-count">Worker Count</Label>
                    <Input
                      id="edit-worker-count"
                      type="number"
                      data-testid="input-edit-worker-count"
                      value={editData.workerCount || 0}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          workerCount: parseInt(e.target.value) || 0,
                        })
                      }
                      min={0}
                    />
                  </div>
                  <div className="flex gap-2 pt-4">
                    <Button
                      onClick={handleSave}
                      disabled={updateMutation.isPending}
                      data-testid="button-save"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {updateMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleCancelEdit}
                      data-testid="button-cancel-edit"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
