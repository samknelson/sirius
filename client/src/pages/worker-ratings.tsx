import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Star } from "lucide-react";
import type { WorkerRating, OptionsWorkerRating } from "@shared/schema";

interface WorkerRatingWithDetails extends WorkerRating {
  ratingType?: OptionsWorkerRating | null;
}

interface RatingWithLevel extends OptionsWorkerRating {
  level: number;
}

function buildHierarchy(ratings: OptionsWorkerRating[]): RatingWithLevel[] {
  const result: RatingWithLevel[] = [];
  const childrenMap = new Map<string | null, OptionsWorkerRating[]>();
  
  for (const rating of ratings) {
    const parentKey = rating.parent || null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)!.push(rating);
  }

  Array.from(childrenMap.values()).forEach(children => {
    children.sort((a: OptionsWorkerRating, b: OptionsWorkerRating) => a.name.localeCompare(b.name));
  });

  const processed = new Set<string>();

  function addWithChildren(rating: OptionsWorkerRating, level: number) {
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

function RatingsContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('staff');

  const { data: workerRatings = [], isLoading: isLoadingRatings } = useQuery<WorkerRatingWithDetails[]>({
    queryKey: ["/api/worker-ratings/worker", worker.id],
  });

  const { data: allRatingTypes = [], isLoading: isLoadingTypes } = useQuery<OptionsWorkerRating[]>({
    queryKey: ["/api/options/worker-rating"],
  });

  const hierarchicalRatingTypes = buildHierarchy(allRatingTypes);

  const ratingValueMap = new Map<string, number | null>();
  for (const wr of workerRatings) {
    ratingValueMap.set(wr.ratingId, wr.value);
  }

  const upsertMutation = useMutation({
    mutationFn: async (data: { ratingId: string; value: number | null }) => {
      return apiRequest("POST", `/api/worker-ratings/worker/${worker.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-ratings/worker", worker.id] });
      toast({
        title: "Rating updated",
        description: "The rating has been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update rating",
        variant: "destructive",
      });
    },
  });

  const handleRatingChange = (ratingId: string, value: string) => {
    const numericValue = value === "none" ? null : parseInt(value, 10);
    upsertMutation.mutate({ ratingId, value: numericValue });
  };

  const isLoading = isLoadingRatings || isLoadingTypes;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5" />
          Ratings
        </CardTitle>
        <CardDescription>
          Manage performance ratings for this worker. Select a value from 0-4 or "None" to remove a rating.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hierarchicalRatingTypes.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No rating types have been configured. Add rating types in Config &gt; Workers &gt; Rating Types.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rating Type</TableHead>
                <TableHead className="w-32">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hierarchicalRatingTypes.map((ratingType) => {
                const currentValue = ratingValueMap.get(ratingType.id);
                const displayValue = currentValue !== undefined && currentValue !== null 
                  ? currentValue.toString() 
                  : "none";
                
                return (
                  <TableRow key={ratingType.id} data-testid={`row-rating-${ratingType.id}`}>
                    <TableCell>
                      <span style={{ paddingLeft: `${ratingType.level * 1.5}rem` }}>
                        {ratingType.level > 0 && <span className="text-muted-foreground mr-2">└</span>}
                        {ratingType.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={displayValue}
                        onValueChange={(value) => handleRatingChange(ratingType.id, value)}
                        disabled={!canEdit || upsertMutation.isPending}
                      >
                        <SelectTrigger 
                          className="w-24" 
                          data-testid={`select-rating-value-${ratingType.id}`}
                        >
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="0">0</SelectItem>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="3">3</SelectItem>
                          <SelectItem value="4">4</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerRatingsPage() {
  return (
    <WorkerLayout activeTab="ratings">
      <RatingsContent />
    </WorkerLayout>
  );
}
