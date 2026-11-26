import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StarRating } from "./components/StarRating";
interface WorkerRatingWithType {
  id: string; value: number; ratingType: { id: string; name: string } | null;
}
export default function WorkerRatingsSection({ workerId }: { workerId: string }) {
  const { data: ratings = [], isLoading, isError } = useQuery<WorkerRatingWithType[]>({
    queryKey: ["/api/worker-ratings/worker", workerId],
    queryFn: async () => {
      const response = await fetch(`/api/worker-ratings/worker/${workerId}`);
      if (!response.ok) throw new Error("Failed to fetch worker ratings");
      return response.json();
    },
  });
  if (isError) return <div role="alert">Unable to load worker ratings.</div>;
  if (isLoading) return <div className="border-t pt-3 space-y-2"><div className="text-sm font-medium text-muted-foreground">Ratings</div><Skeleton className="h-16 w-full" /></div>;
  if (!ratings.length) return <div className="border-t pt-3"><div className="text-sm font-medium text-muted-foreground">Ratings</div><div className="text-sm text-muted-foreground mt-1">No ratings assigned</div></div>;
  return <div className="border-t pt-3">
    <div className="text-sm font-medium text-muted-foreground mb-2">Ratings</div>
    <div className="grid grid-cols-2 gap-2">{ratings.map(rating => <div key={rating.id} className="flex items-center justify-between bg-muted/50 rounded-md px-2 py-1.5">
      <span className="text-sm truncate mr-2">{rating.ratingType?.name ?? "Unknown rating"}</span><StarRating value={rating.value} />
    </div>)}</div>
  </div>;
}
