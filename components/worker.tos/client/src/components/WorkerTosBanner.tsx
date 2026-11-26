import { useMemo } from "react";
import { CalendarOff } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { WorkerTos } from "../../../shared/schema/worker/tos/schema";
import { sanitizeHtml } from "@shared/utils/html";
import { useVariableValue } from "@/lib/use-variable";
import { TOS_BANNER_VARIABLE_NAME, TOS_BANNER_DEFAULT_HTML } from "../lib/worker-tos-banner";

export default function WorkerTosBanner({ workerId }: { workerId: string }) {
  const { data: records, isError } = useQuery<WorkerTos[]>({
    queryKey: ["/api/workers", workerId, "tos"], retry: false,
  });
  const { data: bannerValue } = useVariableValue(TOS_BANNER_VARIABLE_NAME);
  const openAbsence = records?.find(r => r.endDate === null);
  const html = useMemo(() => sanitizeHtml(
    typeof bannerValue === "string" && bannerValue ? bannerValue : TOS_BANNER_DEFAULT_HTML,
    "authored-document",
  ), [bannerValue]);
  if (isError || !openAbsence) return null;
  return <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100 px-4 py-3 mb-6 flex items-start gap-3"
    role="alert" data-testid={`banner-worker-tos-${workerId}`}>
    <CalendarOff className="h-5 w-5 mt-0.5 shrink-0" />
    <div className="flex-1 min-w-0">
      <div className="text-sm [&_a]:underline [&_a]:font-medium" data-testid="text-tos-banner-message" dangerouslySetInnerHTML={{ __html: html }} />
      <Link href={`/workers/${workerId}/employment/tos`} className="text-sm font-medium underline mt-1 inline-block" data-testid="link-tos-banner-page">
        Go to Time Off Sick
      </Link>
    </div>
  </div>;
}
