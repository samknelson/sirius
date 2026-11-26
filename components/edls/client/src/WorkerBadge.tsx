import { useAccessCheck } from "@/hooks/use-access-check";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

export default function WorkerBadge({ workerId }: { workerId: string }) {
  const { canAccess, isLoading: accessLoading } = useAccessCheck("edls.coordinator", workerId);
  const enabled = !accessLoading && canAccess;
  const { data } = useQuery<{ active: boolean; exists: boolean }>({
    queryKey: ["/api/workers", workerId, "edls"], enabled, retry: false,
  });
  if (!enabled || !data) return null;
  return <Badge variant={data.active ? "default" : "secondary"} data-testid={`badge-edls-status-${workerId}`}>
    EDLS: {data.active ? "Active" : "Inactive"}
  </Badge>;
}
