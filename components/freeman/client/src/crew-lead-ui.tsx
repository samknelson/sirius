import { useQuery } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrewExtensionProps } from "../../../../client/src/lib/package-contributions";

function useCrewLeads() {
  return useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/sitespecific/freeman/crewleads"] }).data ?? [];
}
export function CrewLeadEditor({crew, index, onChange}: CrewExtensionProps) {
  const leads = useCrewLeads();
  const data = crew.data as Record<string, any> | null;
  const current = data?.freemanCrewLeadId as string | undefined;
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><div className="space-y-1">
    <Label className="text-xs">Crew Lead</Label>
    <Select value={current ?? "__none__"} onValueChange={value => {
      const next = {...data};
      if (value === "__none__") delete next.freemanCrewLeadId;
      else next.freemanCrewLeadId = value;
      onChange?.(Object.keys(next).length ? next : null);
    }}>
      <SelectTrigger data-testid={`select-crew-lead-${index}`}><SelectValue placeholder="None" /></SelectTrigger>
      <SelectContent><SelectItem value="__none__">— None —</SelectItem>
        {current && !leads.some(l => l.id === current) && <SelectItem value={current}>Unknown ({current})</SelectItem>}
        {leads.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
      </SelectContent>
    </Select>
  </div></div>;
}
export function CrewLeadDetail({crew}: CrewExtensionProps) {
  const leads = useCrewLeads();
  const id = (crew.data as Record<string, unknown> | null)?.freemanCrewLeadId;
  if (!id) return null;
  return <div className="flex items-center gap-1" data-testid={`crew-lead-${crew.id}`}>
    <UserCheck className="h-4 w-4" />Crew Lead: <strong>{leads.find(l => l.id === id)?.name ?? "Unknown"}</strong>
  </div>;
}
