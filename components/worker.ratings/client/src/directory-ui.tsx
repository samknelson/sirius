import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableHead } from "@/components/ui/table";
import { StarRating, StarRatingFilter } from "./components/StarRating";
interface RatingOption { id: string; name: string }
type Props = { enabled: boolean; params: URLSearchParams };
export function DirectoryRatingFilters({ enabled, params, update }: Props & { update: (changes: Record<string, string | null>) => void }) {
  const { data: options = [] } = useQuery<RatingOption[]>({ queryKey: ["/api/options/worker-rating"], enabled });
  if (!enabled) return null;
  const selected = params.get("ratingId");
  const rawValue = Number(params.get("ratingValue"));
  const value = Number.isInteger(rawValue) && rawValue >= 1 && rawValue <= 4 ? rawValue : null;
  return <><div className="space-y-1"><label className="text-sm font-medium">Rating</label>
    <Select value={selected || "all"} onValueChange={id => update({ ratingId: id === "all" ? null : id, ratingValue: id === "all" ? null : params.get("ratingValue") })}>
      <SelectTrigger className="w-40" data-testid="select-edls-worker-ranking"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">No rating</SelectItem>{options.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
    </Select></div>
    {selected && <StarRatingFilter value={value} onChange={rating => update({ ratingValue: rating === null ? null : String(rating) })} />}
  </>;
}
export function DirectoryRatingHeader({ enabled, params }: Props) {
  const { data: options = [] } = useQuery<RatingOption[]>({ queryKey: ["/api/options/worker-rating"], enabled });
  return enabled && params.get("ratingId") ? <TableHead>{options.find(option => option.id === params.get("ratingId"))?.name ?? "Rating"}</TableHead> : null;
}
export function DirectoryRatingCell({ enabled, params, value }: Props & { value: number | null }) {
  return enabled && params.get("ratingId") ? <TableCell>{value === null ? "—" : <StarRating value={value} />}</TableCell> : null;
}
