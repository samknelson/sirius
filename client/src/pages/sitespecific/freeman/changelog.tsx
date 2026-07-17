import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ChangelogEntry {
  date: string;
  version: string;
  changes: string[];
}

// Newest-first list of Freeman deployment releases. Append new releases at
// the TOP of this array.
const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    date: "7/17/2026",
    version: "1.0.0-a2",
    changes: ["Fixed display bug in rating labels on modal popup"],
  },
  {
    date: "7/16/2026",
    version: "1.0.0-a1",
    changes: ["Initial docker bundle and deployment", "Built changelog page"],
  },
];

export default function FreemanChangelogPage() {
  usePageTitle("Freeman Deployment Changelog");

  return (
    <div
      className="container mx-auto py-6 px-4 space-y-4 max-w-3xl"
      data-testid="page-freeman-changelog"
    >
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-page-title">
            Freeman Deployment Changelog
          </CardTitle>
          <CardDescription>
            A record of what changed in each Freeman deployment release, newest
            first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {CHANGELOG_ENTRIES.map((entry) => (
            <div
              key={entry.version}
              className="border rounded-md p-4 space-y-2"
              data-testid={`entry-changelog-${entry.version}`}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <Badge
                  variant="secondary"
                  data-testid={`text-version-${entry.version}`}
                >
                  v{entry.version}
                </Badge>
                <span
                  className="text-sm text-muted-foreground"
                  data-testid={`text-date-${entry.version}`}
                >
                  {entry.date}
                </span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {entry.changes.map((change, i) => (
                  <li key={i} data-testid={`text-change-${entry.version}-${i}`}>
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
