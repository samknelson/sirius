import { useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  takeT631ArrivalRequest,
  type T631ArrivalResponse,
} from "@/lib/t631-arrival-request";

export default function T631ArrivalPage() {
  usePageTitle("Worker Schedule");

  const request = useRef<Promise<T631ArrivalResponse> | null>(null);
  if (!request.current) request.current = takeT631ArrivalRequest();
  const [data, setData] = useState<T631ArrivalResponse | null>(null);

  useEffect(() => {
    let active = true;
    request.current?.then((result) => {
      if (active) setData(result);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!data) {
    return (
      <div className="container mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <ArrivalCard
      error={!data?.authenticated}
      message={data.message}
    />
  );
}

function ArrivalCard({
  error,
  message,
}: {
  error: boolean;
  message: string;
}) {
  const Icon = error ? AlertCircle : CalendarDays;
  return (
    <div className="container mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Icon className={error ? "h-6 w-6 text-destructive" : "h-6 w-6"} />
            <CardTitle>{error ? "Unable to show schedule" : "Worker Schedule"}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p data-testid="text-t631-arrival-result">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}