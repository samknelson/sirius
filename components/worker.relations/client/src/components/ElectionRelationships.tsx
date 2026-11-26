import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
interface RelationOption {
  id: string;
  relationTypeName: string | null;
  otherWorker: { displayName: string | null; given: string | null; family: string | null } | null;
}
export default function ElectionRelationships({ workerId, enabled, ids, onChange, setAvailable }: {
  workerId: string; enabled: boolean; ids: string[]; onChange: (ids: string[]) => void;
  setAvailable: (available: boolean) => void;
}) {
  useEffect(() => { setAvailable(true); return () => setAvailable(false); }, [setAvailable]);
  const { data: relations = [], isError } = useQuery<RelationOption[]>({
    queryKey: ["/api/workers", workerId, "relations"], enabled,
  });
  return <div className="space-y-2">
    <Label>Covered relationships</Label>
    <div className="max-h-40 overflow-auto rounded-md border p-2 space-y-1">
      {isError ? <div role="alert">Unable to load worker relationships.</div> : relations.length === 0 &&
        <div className="text-sm text-muted-foreground">No worker relations on file.</div>}
      {relations.map(r => {
        const name = r.otherWorker ? [r.otherWorker.given, r.otherWorker.family].filter(Boolean).join(" ").trim() || r.otherWorker.displayName || "" : "";
        return <label key={r.id} className="flex items-center gap-2 text-sm">
          <Checkbox checked={ids.includes(r.id)} data-testid={`checkbox-relation-${r.id}`}
            onCheckedChange={() => onChange(ids.includes(r.id) ? ids.filter(id => id !== r.id) : [...ids, r.id])} />
          {`${name || r.id} (${r.relationTypeName || "relation"})`}
        </label>;
      })}
    </div>
  </div>;
}
