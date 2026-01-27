import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { EdlsSheetForm, type SheetFormData } from "@/components/edls/EdlsSheetForm";
import type { EdlsCrew } from "@shared/schema";

function EdlsSheetEditContent() {
  const { sheet } = useEdlsSheetLayout();
  const { toast } = useToast();

  const { data: crews = [], isLoading: crewsLoading } = useQuery<EdlsCrew[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/crews`);
      if (!response.ok) throw new Error("Failed to fetch crews");
      return response.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: SheetFormData) => {
      return apiRequest("PUT", `/api/edls/sheets/${sheet.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id, "crews"] });
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets"] });
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

  const handleSubmit = (data: SheetFormData) => {
    updateMutation.mutate(data);
  };

  if (crewsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Edit Sheet</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit Sheet</CardTitle>
      </CardHeader>
      <CardContent>
        <EdlsSheetForm
          initialData={{ sheet, crews }}
          onSubmit={handleSubmit}
          isSubmitting={updateMutation.isPending}
          submitLabel="Save Changes"
        />
      </CardContent>
    </Card>
  );
}

export default function EdlsSheetEditPage() {
  return (
    <EdlsSheetLayout activeTab="edit">
      <EdlsSheetEditContent />
    </EdlsSheetLayout>
  );
}
