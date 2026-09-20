import { Server } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import EdlsMigrateSweep from "@/components/sitespecific/freeman/EdlsMigrateSweep";
import MigrateSheets from "@/components/sitespecific/freeman/MigrateSheets";

export default function FreemanEdlsMigratePage() {
  usePageTitle("Freeman EDLS Migration");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Freeman EDLS Migration
          </CardTitle>
          <CardDescription>
            The Freeman EDLS connection is configured and tested under the shared web-client
            Vendors admin area. Use the staging sweep to inspect legacy data, then use the
            controlled importer below to migrate sheets in test or live mode.
          </CardDescription>
        </CardHeader>
      </Card>

      <EdlsMigrateSweep />
      <MigrateSheets />
    </div>
  );
}
