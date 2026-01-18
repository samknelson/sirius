import { useState, useMemo, createContext, useContext } from "react";
import { format } from "date-fns";
import { Calendar, Users, Clock, MapPin, User, ClipboardList, UserPlus, Search, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { EdlsSheetStatus, EdlsCrew } from "@shared/schema";

interface EdlsCrewWithRelations extends EdlsCrew {
  supervisorUser?: UserInfo;
  task?: { id: string; name: string };
}

interface UserInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

interface AssignmentWithWorker {
  id: string;
  crewId: string;
  workerId: string;
  date: string;
  worker: {
    id: string;
    siriusId: number | null;
    displayName: string | null;
    given: string | null;
    family: string | null;
  };
}

interface AssignmentsContextValue {
  selectedCrewId: string | null;
  setSelectedCrewId: (id: string | null) => void;
  assignments: AssignmentWithWorker[];
  assignWorker: (workerId: string) => void;
  unassignWorker: (assignmentId: string) => void;
  isAssigning: boolean;
  isUnassigning: boolean;
}

const AssignmentsContext = createContext<AssignmentsContextValue | null>(null);

function useAssignments() {
  const ctx = useContext(AssignmentsContext);
  if (!ctx) throw new Error("useAssignments must be used within AssignmentsProvider");
  return ctx;
}

function formatUserName(user: UserInfo | undefined): string {
  if (!user) return "Not assigned";
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.email;
}

const statusColors: Record<EdlsSheetStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  request: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  lock: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  trash: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  reserved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const statusLabels: Record<EdlsSheetStatus, string> = {
  draft: "Draft",
  request: "Request",
  lock: "Locked",
  trash: "Trash",
  reserved: "Reserved",
};

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function SheetSummary() {
  const { sheet } = useEdlsSheetLayout();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg" data-testid="text-sheet-title">{sheet.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1.5" data-testid="text-sheet-date">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            {format(new Date(sheet.date + "T00:00:00"), "EEE, MMM d, yyyy")}
          </div>
          <div className="flex items-center gap-1.5" data-testid="text-sheet-workers">
            <Users className="h-4 w-4 text-muted-foreground" />
            {sheet.workerCount} workers needed
          </div>
          <Badge 
            className={statusColors[(sheet.status as EdlsSheetStatus) || "draft"]}
            data-testid="badge-sheet-status"
          >
            {statusLabels[(sheet.status as EdlsSheetStatus) || "draft"]}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function formatAssignedWorkerName(worker: AssignmentWithWorker["worker"]): string {
  if (worker.displayName) return worker.displayName;
  if (worker.given || worker.family) {
    return [worker.given, worker.family].filter(Boolean).join(" ");
  }
  return worker.siriusId ? `Worker #${worker.siriusId}` : "Unknown Worker";
}

interface AssignedWorkerSlotProps {
  assignment: AssignmentWithWorker;
}

function AssignedWorkerSlot({ assignment }: AssignedWorkerSlotProps) {
  const { unassignWorker, isUnassigning } = useAssignments();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    unassignWorker(assignment.id);
  };

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-2 p-2 border rounded-md bg-background cursor-pointer hover-elevate ${isUnassigning ? "pointer-events-none opacity-50" : ""}`}
      data-testid={`assigned-${assignment.id}`}
    >
      <span className="text-sm">{formatAssignedWorkerName(assignment.worker)}</span>
      {assignment.worker.siriusId && (
        <Badge variant="outline" className="ml-auto text-xs">
          #{assignment.worker.siriusId}
        </Badge>
      )}
    </div>
  );
}

interface EmptySlotProps {
  slotIndex: number;
  crewId: string;
}

function EmptySlot({ slotIndex, crewId }: EmptySlotProps) {
  return (
    <div
      className="flex items-center gap-2 p-2 border border-dashed rounded-md bg-muted/30"
      data-testid={`slot-${crewId}-${slotIndex}`}
    >
      <UserPlus className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Empty slot</span>
    </div>
  );
}

interface CrewCardProps {
  crew: EdlsCrewWithRelations;
}

function CrewCard({ crew }: CrewCardProps) {
  const { selectedCrewId, setSelectedCrewId, assignments } = useAssignments();
  const isSelected = selectedCrewId === crew.id;
  
  const crewAssignments = assignments.filter(a => a.crewId === crew.id);
  const emptySlotCount = Math.max(0, crew.workerCount - crewAssignments.length);
  const emptySlots = Array.from({ length: emptySlotCount }, (_, i) => i);

  const handleClick = () => {
    setSelectedCrewId(isSelected ? null : crew.id);
  };

  return (
    <Card 
      className={`cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary" : "hover-elevate"}`}
      onClick={handleClick}
      data-testid={`crew-card-${crew.id}`}
    >
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {isSelected && <Check className="h-4 w-4 text-primary" />}
            <CardTitle className="text-base" data-testid={`crew-title-${crew.id}`}>
              {crew.title}
            </CardTitle>
          </div>
          <Badge variant="secondary" data-testid={`crew-worker-count-${crew.id}`}>
            {crewAssignments.length} / {crew.workerCount}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1" data-testid={`crew-time-${crew.id}`}>
            <Clock className="h-3 w-3" />
            {formatTime(crew.startTime)} - {formatTime(crew.endTime)}
          </div>
          {crew.location && (
            <div className="flex items-center gap-1" data-testid={`crew-location-${crew.id}`}>
              <MapPin className="h-3 w-3" />
              {crew.location}
            </div>
          )}
          {crew.task && (
            <div className="flex items-center gap-1" data-testid={`crew-task-${crew.id}`}>
              <ClipboardList className="h-3 w-3" />
              {crew.task.name}
            </div>
          )}
          <div className="flex items-center gap-1" data-testid={`crew-supervisor-${crew.id}`}>
            <User className="h-3 w-3" />
            {formatUserName(crew.supervisorUser)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {crewAssignments.map((assignment) => (
            <AssignedWorkerSlot key={assignment.id} assignment={assignment} />
          ))}
          {emptySlots.map((slotIndex) => (
            <EmptySlot key={`empty-${slotIndex}`} slotIndex={slotIndex} crewId={crew.id} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CrewsList() {
  const { sheet } = useEdlsSheetLayout();
  const { selectedCrewId } = useAssignments();

  const { data: crews = [], isLoading } = useQuery<EdlsCrewWithRelations[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/crews`);
      if (!response.ok) throw new Error("Failed to fetch crews");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (crews.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center" data-testid="text-no-crews">
            No crews on this sheet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!selectedCrewId && (
        <p className="text-sm text-muted-foreground">Click a crew to select it, then click a worker to assign them.</p>
      )}
      {crews.map((crew) => (
        <CrewCard key={crew.id} crew={crew} />
      ))}
    </div>
  );
}

interface AvailableWorker {
  id: string;
  siriusId: number | null;
  contactId: string;
  displayName: string | null;
  given: string | null;
  family: string | null;
}

function formatWorkerName(worker: AvailableWorker): string {
  if (worker.displayName) return worker.displayName;
  if (worker.given || worker.family) {
    return [worker.given, worker.family].filter(Boolean).join(" ");
  }
  return worker.siriusId ? `Worker #${worker.siriusId}` : "Unknown Worker";
}

function AvailableWorkersPanel() {
  const { sheet } = useEdlsSheetLayout();
  const { selectedCrewId, assignWorker, isAssigning } = useAssignments();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: workers = [], isLoading } = useQuery<AvailableWorker[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "available-workers"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/available-workers`);
      if (!response.ok) throw new Error("Failed to fetch available workers");
      return response.json();
    },
  });

  const filteredWorkers = useMemo(() => {
    if (!searchTerm.trim()) return workers;
    const term = searchTerm.toLowerCase();
    return workers.filter((worker) => {
      const name = formatWorkerName(worker).toLowerCase();
      return name.includes(term);
    });
  }, [workers, searchTerm]);

  const handleWorkerClick = (worker: AvailableWorker) => {
    if (!selectedCrewId) {
      toast({
        title: "No crew selected",
        description: "Please select a crew first before assigning a worker.",
        variant: "destructive",
      });
      return;
    }
    assignWorker(worker.id);
  };

  return (
    <Card className="sticky top-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Available Workers ({workers.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-workers"
          />
        </div>
        
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filteredWorkers.length === 0 ? (
          <p className="text-muted-foreground text-center py-4 text-sm" data-testid="text-no-workers">
            {workers.length === 0 ? "No workers available" : "No matching workers"}
          </p>
        ) : (
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {filteredWorkers.map((worker) => (
              <div
                key={worker.id}
                onClick={() => handleWorkerClick(worker)}
                className={`flex items-center gap-2 p-2 rounded-md cursor-pointer ${
                  selectedCrewId ? "hover-elevate" : "opacity-60"
                } ${isAssigning ? "pointer-events-none opacity-50" : ""}`}
                data-testid={`worker-${worker.id}`}
              >
                <span className="text-sm truncate">{formatWorkerName(worker)}</span>
                {worker.siriusId && (
                  <Badge variant="outline" className="ml-auto text-xs">
                    #{worker.siriusId}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EdlsSheetAssignmentsContent() {
  const { sheet } = useEdlsSheetLayout();
  const { toast } = useToast();
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);

  const { data: assignments = [] } = useQuery<AssignmentWithWorker[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "assignments"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/assignments`);
      if (!response.ok) throw new Error("Failed to fetch assignments");
      return response.json();
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (workerId: string) => {
      return apiRequest("POST", `/api/edls/sheets/${sheet.id}/crews/${selectedCrewId}/assignments`, { workerId });
    },
    onSuccess: () => {
      toast({
        title: "Worker assigned",
        description: "The worker has been assigned to the crew.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id, "assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id, "available-workers"] });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to assign worker";
      toast({
        title: "Assignment failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest("DELETE", `/api/edls/sheets/${sheet.id}/assignments/${assignmentId}`);
    },
    onSuccess: () => {
      toast({
        title: "Worker unassigned",
        description: "The worker has been removed from the crew.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id, "assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id, "available-workers"] });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to unassign worker";
      toast({
        title: "Unassignment failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const contextValue: AssignmentsContextValue = {
    selectedCrewId,
    setSelectedCrewId,
    assignments,
    assignWorker: (workerId: string) => assignMutation.mutate(workerId),
    unassignWorker: (assignmentId: string) => unassignMutation.mutate(assignmentId),
    isAssigning: assignMutation.isPending,
    isUnassigning: unassignMutation.isPending,
  };

  return (
    <AssignmentsContext.Provider value={contextValue}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <SheetSummary />
          <CrewsList />
        </div>
        <div className="lg:col-span-1">
          <AvailableWorkersPanel />
        </div>
      </div>
    </AssignmentsContext.Provider>
  );
}

export default function EdlsSheetAssignmentsPage() {
  return (
    <EdlsSheetLayout activeTab="assignments">
      <EdlsSheetAssignmentsContent />
    </EdlsSheetLayout>
  );
}
