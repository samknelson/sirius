import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  takeT631ArrivalRequest,
  scheduleDestination,
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
      if (!active) return;
      const destination = scheduleDestination(result);
      if (destination) {
        // A fresh arrival always resolves the worker's current key. Do not
        // retain the arrival URL in browser history or cache a redirect.
        window.location.replace(destination);
        return;
      }
      setData(result.authenticated
        ? { authenticated: false, message: "The worker schedule could not be opened. Please try again later." }
        : result);
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
      message={data.message}
    />
  );
}

function ArrivalCard({
  message,
}: {
  message: string;
}) {
  return (
    <div className="container mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <CardTitle>Unable to show schedule</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p data-testid="text-t631-arrival-result">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}