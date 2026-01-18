import { useState, useMemo, createContext, useContext } from "react";
import { Link } from "wouter";
import { formatYmd } from "@shared/utils/date";
import { Calendar, Users, Clock, MapPin, User, ClipboardList, UserPlus, Search, Check, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { EdlsSheetStatus, EdlsCrew } from "@shared/schema";

interface WorkerAssignmentDetail {
  sheetId: string;
  sheetName: string;
  sheetYmd: string;
  sheetStatus: string;
  crewId: string;
  crewName: string;
  startTime: string | null;
  endTime: string | null;
  supervisorName: string | null;
}

interface WorkerAssignmentDetails {
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
  prior: WorkerAssignmentDetail | null;
  current: WorkerAssignmentDetail | null;
  next: WorkerAssignmentDetail | null;
}

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
  ymd: string;
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
  selectedRatingId: string;
  setSelectedRatingId: (id: string) => void;
  workerRatingsMap: Map<string, number>;
  ratingsEnabled: boolean;
  hierarchicalRatings: RatingOptionWithLevel[];
  availableWorkers: AvailableWorker[];
  isLoadingWorkers: boolean;
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
            {formatYmd(sheet.ymd, 'weekday-long')}
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
  crewId: string;
}

function AssignedWorkerSlot({ assignment, crewId }: AssignedWorkerSlotProps) {
  const { unassignWorker, isUnassigning, setSelectedCrewId } = useAssignments();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedCrewId(crewId);
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
  const { selectedCrewId, setSelectedCrewId, assignments, selectedRatingId, workerRatingsMap } = useAssignments();
  const isSelected = selectedCrewId === crew.id;
  
  const crewAssignments = assignments.filter(a => a.crewId === crew.id);
  const emptySlotCount = Math.max(0, crew.workerCount - crewAssignments.length);
  const emptySlots = Array.from({ length: emptySlotCount }, (_, i) => i);

  const ratingStats = useMemo(() => {
    if (selectedRatingId === "all") return null;
    
    let total = 0;
    let count = 0;
    for (const assignment of crewAssignments) {
      const rating = workerRatingsMap.get(assignment.workerId);
      if (rating !== undefined) {
        total += rating;
        count++;
      }
    }
    
    if (count === 0) return { total: 0, average: 0, count: 0 };
    return { total, average: Math.round((total / count) * 10) / 10, count };
  }, [crewAssignments, selectedRatingId, workerRatingsMap]);

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
          <div className="flex items-center gap-2">
            {ratingStats && (
              <Badge variant="outline" className="text-xs" data-testid={`crew-rating-${crew.id}`}>
                <Star className="h-3 w-3 mr-1 text-yellow-400" fill="currentColor" />
                {ratingStats.total} ({ratingStats.average})
              </Badge>
            )}
            <Badge variant="secondary" data-testid={`crew-worker-count-${crew.id}`}>
              {crewAssignments.length} / {crew.workerCount}
            </Badge>
          </div>
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
            <AssignedWorkerSlot key={assignment.id} assignment={assignment} crewId={crew.id} />
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
  const { selectedCrewId, selectedRatingId, workerRatingsMap, assignments } = useAssignments();

  const { data: crews = [], isLoading } = useQuery<EdlsCrewWithRelations[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/crews`);
      if (!response.ok) throw new Error("Failed to fetch crews");
      return response.json();
    },
  });

  const sheetRatingStats = useMemo(() => {
    if (selectedRatingId === "all") return null;
    
    let total = 0;
    let count = 0;
    for (const assignment of assignments) {
      const rating = workerRatingsMap.get(assignment.workerId);
      if (rating !== undefined) {
        total += rating;
        count++;
      }
    }
    
    if (count === 0) return { total: 0, average: 0, count: 0 };
    return { total, average: Math.round((total / count) * 10) / 10, count };
  }, [assignments, selectedRatingId, workerRatingsMap]);

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
      {sheetRatingStats && (
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
          <span className="text-sm text-muted-foreground">Sheet Rating Totals</span>
          <Badge variant="outline" data-testid="sheet-rating-stats">
            <Star className="h-3 w-3 mr-1 text-yellow-400" fill="currentColor" />
            Total: {sheetRatingStats.total} | Avg: {sheetRatingStats.average}
          </Badge>
        </div>
      )}
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
  priorStatus: string | null;
  currentStatus: string | null;
  nextStatus: string | null;
  ratingValue: number | null;
}

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

interface RatingOption {
  id: string;
  name: string;
  parent: string | null;
}

interface RatingOptionWithLevel extends RatingOption {
  level: number;
}

function buildRatingHierarchy(ratings: RatingOption[]): RatingOptionWithLevel[] {
  const result: RatingOptionWithLevel[] = [];
  const childrenMap = new Map<string | null, RatingOption[]>();
  
  for (const rating of ratings) {
    const parentKey = rating.parent || null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)!.push(rating);
  }

  Array.from(childrenMap.values()).forEach(children => {
    children.sort((a, b) => a.name.localeCompare(b.name));
  });

  const processed = new Set<string>();

  function addWithChildren(rating: RatingOption, level: number) {
    if (processed.has(rating.id)) return;
    processed.add(rating.id);
    result.push({ ...rating, level });
    
    const children = childrenMap.get(rating.id) || [];
    for (const child of children) {
      addWithChildren(child, level + 1);
    }
  }

  const topLevel = childrenMap.get(null) || [];
  for (const rating of topLevel) {
    addWithChildren(rating, 0);
  }

  for (const rating of ratings) {
    if (!processed.has(rating.id)) {
      result.push({ ...rating, level: 0 });
      processed.add(rating.id);
    }
  }

  return result;
}

function formatWorkerName(worker: AvailableWorker): string {
  if (worker.displayName) return worker.displayName;
  if (worker.given || worker.family) {
    return [worker.given, worker.family].filter(Boolean).join(" ");
  }
  return worker.siriusId ? `Worker #${worker.siriusId}` : "Unknown Worker";
}

function getStatusDotColor(status: string | null): string {
  switch (status) {
    case "draft": return "bg-gray-400";
    case "request": return "bg-yellow-400";
    case "lock": return "bg-green-500";
    case "trash": return "bg-red-500";
    case "reserved": return "bg-blue-500";
    default: return "bg-white border border-gray-300";
  }
}

function formatWorkerFullName(details: WorkerAssignmentDetails): string {
  if (details.displayName) return details.displayName;
  if (details.given || details.family) {
    return [details.given, details.family].filter(Boolean).join(" ");
  }
  return details.siriusId ? `Worker #${details.siriusId}` : "Unknown Worker";
}

function getStatusCardStyle(status: string): string {
  switch (status) {
    case "draft": return "bg-gray-100 dark:bg-gray-800 border-l-4 border-l-gray-400";
    case "request": return "bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-l-yellow-400";
    case "lock": return "bg-green-50 dark:bg-green-900/20 border-l-4 border-l-green-500";
    case "trash": return "bg-red-50 dark:bg-red-900/20 border-l-4 border-l-red-500";
    case "reserved": return "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500";
    default: return "bg-muted/50";
  }
}

function AssignmentDetailCard({ label, detail }: { label: string; detail: WorkerAssignmentDetail | null }) {
  if (!detail) {
    return (
      <div className="p-3 rounded-md bg-muted/50">
        <div className="text-xs text-muted-foreground font-medium mb-1">{label}</div>
        <div className="text-sm text-muted-foreground italic">No assignment</div>
      </div>
    );
  }

  return (
    <div className={`p-3 rounded-md ${getStatusCardStyle(detail.sheetStatus)}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Badge variant="outline">
          {detail.sheetStatus}
        </Badge>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-3 w-3 text-muted-foreground" />
          <Link 
            href={`/edls/sheet/${detail.sheetId}`}
            className="font-medium text-primary hover:underline"
            data-testid={`link-sheet-${detail.sheetId}`}
          >
            {detail.sheetName}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span>{formatYmd(detail.sheetYmd, "weekday-long")}</span>
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span>{detail.crewName}</span>
        </div>
        {detail.supervisorName && (
          <div className="flex items-center gap-2">
            <User className="h-3 w-3 text-muted-foreground" />
            <span>{detail.supervisorName}</span>
          </div>
        )}
        {(detail.startTime || detail.endTime) && (
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span>{detail.startTime || "—"} - {detail.endTime || "—"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface WorkerRatingWithName {
  id: string;
  workerId: string;
  ratingId: string;
  value: number;
  ratingName: string;
}

function WorkerRatingsSection({ workerId, ratingsEnabled }: { workerId: string; ratingsEnabled: boolean }) {
  const { data: ratings = [], isLoading } = useQuery<WorkerRatingWithName[]>({
    queryKey: ["/api/worker-ratings/worker", workerId],
    queryFn: async () => {
      const response = await fetch(`/api/worker-ratings/worker/${workerId}`);
      if (!response.ok) throw new Error("Failed to fetch worker ratings");
      return response.json();
    },
    enabled: ratingsEnabled,
  });

  if (!ratingsEnabled) return null;
  
  if (isLoading) {
    return (
      <div className="border-t pt-3 space-y-2">
        <div className="text-sm font-medium text-muted-foreground">Ratings</div>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (ratings.length === 0) {
    return (
      <div className="border-t pt-3">
        <div className="text-sm font-medium text-muted-foreground">Ratings</div>
        <div className="text-sm text-muted-foreground mt-1">No ratings assigned</div>
      </div>
    );
  }

  return (
    <div className="border-t pt-3">
      <div className="text-sm font-medium text-muted-foreground mb-2">Ratings</div>
      <div className="grid grid-cols-2 gap-2">
        {ratings.map((rating) => (
          <div key={rating.id} className="flex items-center justify-between bg-muted/50 rounded-md px-2 py-1.5">
            <span className="text-sm truncate mr-2">{rating.ratingName}</span>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {[0, 1, 2, 3].map((i) => (
                <Star
                  key={i}
                  className={`h-3 w-3 ${i < rating.value ? "text-yellow-400" : "text-muted-foreground/30"}`}
                  fill={i < rating.value ? "currentColor" : "none"}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkerAssignmentModal({ 
  worker, 
  open, 
  onOpenChange 
}: { 
  worker: AvailableWorker; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const { sheet } = useEdlsSheetLayout();
  
  const { data: details, isLoading } = useQuery<WorkerAssignmentDetails>({
    queryKey: ["/api/edls/sheets", sheet.id, "workers", worker.id, "assignment-details"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/workers/${worker.id}/assignment-details`);
      if (!response.ok) throw new Error("Failed to fetch assignment details");
      return response.json();
    },
    enabled: open,
  });

  const { data: componentConfigs = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });
  
  const ratingsEnabled = componentConfigs.find(c => c.componentId === "worker.ratings")?.enabled ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Worker Assignment Details</DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : details ? (
          <div className="space-y-4">
            <div className="border-b pb-3">
              <div className="text-lg font-semibold">{formatWorkerFullName(details)}</div>
              <div className="flex gap-2 mt-1">
                {details.siriusId && (
                  <Badge variant="secondary">ID: {details.siriusId}</Badge>
                )}
                <Badge variant="outline">Worker ID: {details.workerId.slice(0, 8)}...</Badge>
              </div>
            </div>
            
            <div className="space-y-3">
              <AssignmentDetailCard label="Prior Assignment" detail={details.prior} />
              <AssignmentDetailCard label="Current Assignment (Same Day)" detail={details.current} />
              <AssignmentDetailCard label="Next Assignment" detail={details.next} />
            </div>
            
            <WorkerRatingsSection workerId={worker.id} ratingsEnabled={ratingsEnabled} />
          </div>
        ) : (
          <div className="text-muted-foreground">No details available</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusDots({ worker }: { worker: AvailableWorker }) {
  const [modalOpen, setModalOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setModalOpen(true);
  };

  return (
    <>
      <div 
        className="flex items-center gap-0.5 flex-shrink-0 cursor-pointer hover:opacity-80 p-1 -m-1 rounded"
        onClick={handleClick}
        onMouseDown={(e) => e.stopPropagation()}
        data-testid={`status-dots-${worker.id}`}
        title="Click to view assignment details"
      >
        <div 
          className={`w-2 h-2 rounded-full ${getStatusDotColor(worker.priorStatus)}`}
        />
        <div 
          className={`w-2 h-2 rounded-full ${getStatusDotColor(worker.currentStatus)}`}
        />
        <div 
          className={`w-2 h-2 rounded-full ${getStatusDotColor(worker.nextStatus)}`}
        />
      </div>
      <WorkerAssignmentModal 
        worker={worker} 
        open={modalOpen} 
        onOpenChange={setModalOpen} 
      />
    </>
  );
}

type AssignmentFilter = "all" | "include" | "exclude";

function StarRating({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i < value ? "text-yellow-400" : "text-muted-foreground/30"}`}
          fill={i < value ? "currentColor" : "none"}
        />
      ))}
    </div>
  );
}

function AvailableWorkersPanel() {
  const { 
    selectedCrewId, 
    assignWorker, 
    isAssigning, 
    assignments,
    selectedRatingId,
    setSelectedRatingId,
    ratingsEnabled,
    hierarchicalRatings,
    availableWorkers: workers,
    isLoadingWorkers: isLoading
  } = useAssignments();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [currentFilter, setCurrentFilter] = useState<AssignmentFilter>("all");
  const [nextFilter, setNextFilter] = useState<AssignmentFilter>("all");
  
  const assignedWorkerIds = useMemo(() => 
    new Set(assignments.map(a => a.workerId)), 
    [assignments]
  );

  const filteredWorkers = useMemo(() => {
    let result = workers;
    
    if (currentFilter === "include") {
      result = result.filter(w => w.currentStatus !== null);
    } else if (currentFilter === "exclude") {
      result = result.filter(w => w.currentStatus === null);
    }
    
    if (nextFilter === "include") {
      result = result.filter(w => w.nextStatus !== null);
    } else if (nextFilter === "exclude") {
      result = result.filter(w => w.nextStatus === null);
    }
    
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter((worker) => {
        const name = formatWorkerName(worker).toLowerCase();
        return name.includes(term);
      });
    }
    
    return result;
  }, [workers, searchTerm, currentFilter, nextFilter]);

  const handleWorkerClick = (worker: AvailableWorker) => {
    if (assignedWorkerIds.has(worker.id)) {
      return;
    }
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
        
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Current</label>
            <Select value={currentFilter} onValueChange={(v) => setCurrentFilter(v as AssignmentFilter)}>
              <SelectTrigger data-testid="select-current-filter" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="include">Has assignment</SelectItem>
                <SelectItem value="exclude">No assignment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Next</label>
            <Select value={nextFilter} onValueChange={(v) => setNextFilter(v as AssignmentFilter)}>
              <SelectTrigger data-testid="select-next-filter" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="include">Has assignment</SelectItem>
                <SelectItem value="exclude">No assignment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {ratingsEnabled && hierarchicalRatings.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Rating</label>
            <Select value={selectedRatingId} onValueChange={setSelectedRatingId}>
              <SelectTrigger data-testid="select-rating-filter" className="h-8 text-xs">
                <SelectValue placeholder="All workers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workers</SelectItem>
                {hierarchicalRatings.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    <span style={{ paddingLeft: `${option.level * 12}px` }}>
                      {option.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        
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
            {filteredWorkers.map((worker) => {
              const isAssigned = assignedWorkerIds.has(worker.id);
              return (
                <div
                  key={worker.id}
                  onClick={() => handleWorkerClick(worker)}
                  className={`flex items-center gap-2 p-2 rounded-md ${
                    isAssigned 
                      ? "cursor-default opacity-70" 
                      : `cursor-pointer ${selectedCrewId ? "hover-elevate" : "opacity-60"}`
                  } ${isAssigning ? "pointer-events-none opacity-50" : ""}`}
                  data-testid={`worker-${worker.id}`}
                >
                  <StatusDots worker={worker} />
                  {selectedRatingId && selectedRatingId !== "all" && worker.ratingValue !== null && (
                    <StarRating value={worker.ratingValue} />
                  )}
                  <span className="text-sm truncate">{formatWorkerName(worker)}</span>
                  {worker.siriusId && (
                    <Badge variant="outline" className="ml-auto text-xs">
                      #{worker.siriusId}
                    </Badge>
                  )}
                </div>
              );
            })}
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
  const [selectedRatingId, setSelectedRatingId] = useState<string>("all");

  const { data: assignments = [] } = useQuery<AssignmentWithWorker[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "assignments"],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${sheet.id}/assignments`);
      if (!response.ok) throw new Error("Failed to fetch assignments");
      return response.json();
    },
  });

  const { data: componentConfigs = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });
  
  const ratingsEnabled = componentConfigs.find(c => c.componentId === "worker.ratings")?.enabled ?? false;

  const { data: ratingOptions = [] } = useQuery<RatingOption[]>({
    queryKey: ["/api/options/worker-rating"],
    enabled: ratingsEnabled,
  });

  const hierarchicalRatings = useMemo(() => buildRatingHierarchy(ratingOptions), [ratingOptions]);

  const { data: availableWorkers = [], isLoading: isLoadingWorkers } = useQuery<AvailableWorker[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "available-workers", selectedRatingId],
    queryFn: async () => {
      const url = selectedRatingId && selectedRatingId !== "all"
        ? `/api/edls/sheets/${sheet.id}/available-workers?ratingId=${selectedRatingId}`
        : `/api/edls/sheets/${sheet.id}/available-workers`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch available workers");
      return response.json();
    },
  });

  const workerRatingsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const worker of availableWorkers) {
      if (worker.ratingValue !== null) {
        map.set(worker.id, worker.ratingValue);
      }
    }
    return map;
  }, [availableWorkers]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id, "crews"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id, "crews"] });
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
    selectedRatingId,
    setSelectedRatingId,
    workerRatingsMap,
    ratingsEnabled,
    hierarchicalRatings,
    availableWorkers,
    isLoadingWorkers,
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
