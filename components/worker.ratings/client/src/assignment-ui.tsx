import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StarRating } from "./components/StarRating";
interface RatingOption { id: string; name: string; parent: string | null }
const Ratings = createContext<{
  selected: string; setSelected: (id: string) => void;
  options: (RatingOption & { level: number })[]; values: Map<string, number>;
} | null>(null);
export function AssignmentRatings({ workers, setQueryParameters, children }: {
  workers: { id: string; ratingValue: number | null }[];
  setQueryParameters: (params: Record<string, string>) => void; children: ReactNode;
}) {
  const [selected, setSelected] = useState("all");
  const { data: ratings = [] } = useQuery<RatingOption[]>({ queryKey: ["/api/options/worker-rating"] });
  useEffect(() => {
    setQueryParameters(selected === "all" ? {} : { ratingId: selected });
  }, [selected, setQueryParameters]);
  useEffect(() => () => setQueryParameters({}), [setQueryParameters]);
  const options = useMemo(() => {
    const rows: (RatingOption & { level: number })[] = [];
    const visited = new Set<string>();
    function add(row: RatingOption, level: number) {
      if (visited.has(row.id)) return;
      visited.add(row.id); rows.push({ ...row, level });
      ratings.filter(r => r.parent === row.id).sort((a,b) => a.name.localeCompare(b.name)).forEach(r => add(r, level + 1));
    }
    ratings.filter(r => !r.parent).sort((a,b) => a.name.localeCompare(b.name)).forEach(r => add(r, 0));
    ratings.forEach(r => { if (!visited.has(r.id)) add(r, 0); });
    return rows;
  }, [ratings]);
  const values = useMemo(() => new Map(workers.filter(w => w.ratingValue !== null).map(w => [w.id, w.ratingValue!])), [workers]);
  return <Ratings.Provider value={{ selected, setSelected, options, values }}>{children}</Ratings.Provider>;
}
export function AssignmentRatingSelect() {
  const ctx = useContext(Ratings);
  if (!ctx?.options.length) return null;
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">Rating</label>
    <Select value={ctx.selected} onValueChange={ctx.setSelected}><SelectTrigger data-testid="select-rating-filter" className="h-8 text-xs"><SelectValue placeholder="All ratings" /></SelectTrigger>
      <SelectContent><SelectItem value="all">All workers</SelectItem>
        {ctx.options.map(option => <SelectItem key={option.id} value={option.id}><span style={{ paddingLeft: `${option.level * 12}px` }}>{option.name}</span></SelectItem>)}
      </SelectContent>
    </Select></div>;
}
export function AssignmentRatingValue({ workerId, value }: { workerId: string; value?: number | null }) {
  const ctx = useContext(Ratings);
  if (!ctx || ctx.selected === "all") return null;
  const rating = value ?? ctx.values.get(workerId);
  return rating === undefined ? null : <StarRating value={rating} />;
}
export function AssignmentRatingStats({ assignments, crewId }: { assignments: { workerId: string }[]; crewId?: string }) {
  const ctx = useContext(Ratings);
  if (!ctx || ctx.selected === "all") return null;
  const values = assignments.map(a => ctx.values.get(a.workerId)).filter((v): v is number => v !== undefined);
  const total = values.reduce((sum, v) => sum + v, 0);
  const average = values.length ? Math.round(total / values.length * 10) / 10 : 0;
  return <Badge variant="outline" className={crewId ? "text-xs" : undefined} data-testid={crewId ? `crew-rating-${crewId}` : "sheet-rating-stats"}>
    <Star className="h-3 w-3 mr-1 text-yellow-400" fill="currentColor" />{total} ({average})
  </Badge>;
}
