import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import {
  SheetDetailsView,
  type EdlsCrewWithRelations,
  type AssignmentWithWorker,
} from "@/components/edls/SheetDetailsView";

function EdlsSheetDetailsContent() {
  const { sheet } = useEdlsSheetLayout();
  const search = useSearch();
  const [location, navigate] = useLocation();
  const selectedCrewId = new URLSearchParams(search).get("crew") || "all";

  const setSelectedCrewId = (id: string) => {
    const params = new URLSearchParams(search);
    if (id === "all") {
      params.delete("crew");
    } else {
      params.set("crew", id);
    }
    const qs = params.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: false });
  };

  const { data: crews = [], isLoading: crewsLoading } = useQuery<EdlsCrewWithRelations[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/crews`);
      if (!response.ok) throw new Error("Failed to fetch crews");
      return response.json();
    },
  });

  const { data: assignments = [] } = useQuery<AssignmentWithWorker[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "assignments"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/assignments`);
      if (!response.ok) throw new Error("Failed to fetch assignments");
      return response.json();
    },
  });

  const { data: displayIdData } = useQuery<{ workerIdTypeConfigured: boolean; values: Record<string, string> }>({
    queryKey: ["/api/edls/sheets", sheet.id, "worker-display-ids"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/worker-display-ids`);
      if (!response.ok) throw new Error("Failed to fetch worker display IDs");
      return response.json();
    },
  });

  const { data: eligibleWorkers, isLoading: eligibleLoading } = useQuery<{ id: string }[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "available-workers"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/available-workers`);
      if (!response.ok) throw new Error("Failed to fetch available workers");
      return response.json();
    },
  });

  const eligibleWorkerIds = useMemo(
    () => new Set((eligibleWorkers ?? []).map(w => w.id)),
    [eligibleWorkers],
  );

  return (
    <SheetDetailsView
      sheet={sheet as Record<string, any>}
      crews={crews}
      crewsLoading={crewsLoading}
      assignments={assignments}
      selectedCrewId={selectedCrewId}
      onSelectCrewId={setSelectedCrewId}
      workerIdTypeConfigured={!!displayIdData?.workerIdTypeConfigured}
      displayIdValues={displayIdData?.values ?? {}}
      eligibleWorkerIds={eligibleWorkerIds}
      eligibleLoaded={!eligibleLoading && !!eligibleWorkers}
    />
  );
}

export default function EdlsSheetDetailsPage() {
  return (
    <EdlsSheetLayout activeTab="details">
      <EdlsSheetDetailsContent />
    </EdlsSheetLayout>
  );
}
