/**
 * Shared rendering for system-status plugin output (Task #1258).
 *
 * These started life as local helpers inside the System Status page. They
 * moved here so the admin Restart & Reload page can embed the Container
 * Information plugin's own messages and details and get IDENTICAL output —
 * rather than growing a second, slowly diverging copy of the same markup.
 *
 * Both pages import from here; neither owns a private variant.
 */
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export type StatusPriority = "info" | "notice" | "warning" | "error";

export interface StatusMessage {
  priority: StatusPriority;
  title: string;
  details?: string;
}

export interface StatusDetailRow {
  label: string;
  description?: string;
  value?: string;
  badges?: string[];
  priority?: StatusPriority;
}

export interface StatusDetails {
  groups: { title: string; rows: StatusDetailRow[] }[];
}

export interface SystemStatusEntry {
  id: string;
  name: string;
  description: string;
  canRescan: boolean;
  hasDetails: boolean;
  worstPriority: StatusPriority;
  result: {
    pluginId: string;
    messages: StatusMessage[];
    scannedAt: string;
    durationMs: number;
  };
}

/** Card tint by worst priority, so a page of cards scans at a glance. */
export const CARD_PRIORITY_CLASSES: Record<StatusPriority, string> = {
  info: "border-green-500/50 bg-green-50/50 dark:bg-green-950/20",
  notice: "border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20",
  warning: "border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20",
  error: "border-red-500/50 bg-red-50/50 dark:bg-red-950/20",
};

export function PriorityIcon({ priority }: { priority: StatusPriority }) {
  switch (priority) {
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />;
    case "notice":
      return <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
    default:
      return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />;
  }
}

export function PriorityBadge({ priority }: { priority: StatusPriority }) {
  switch (priority) {
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    case "warning":
      return (
        <Badge className="bg-yellow-500 hover:bg-yellow-500/90 text-white">Warning</Badge>
      );
    case "notice":
      return <Badge variant="secondary">Notice</Badge>;
    default:
      return <Badge variant="outline">Info</Badge>;
  }
}

/** A plugin scan's message list. */
export function StatusMessageList({
  messages,
  testIdPrefix,
}: {
  messages: StatusMessage[];
  /** e.g. "row-status-message-container" */
  testIdPrefix: string;
}) {
  return (
    <ul className="space-y-2">
      {messages.map((message, i) => (
        <li key={i} className="flex items-start gap-2" data-testid={`${testIdPrefix}-${i}`}>
          <PriorityBadge priority={message.priority} />
          <div className="min-w-0">
            <div className="text-sm font-medium">{message.title}</div>
            {message.details && (
              <div className="text-sm text-muted-foreground break-words">
                {message.details}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A plugin's details drill-down, rendered as grouped rows. */
export function StatusDetailsView({ details }: { details: StatusDetails }) {
  return (
    <>
      {details.groups.map((group) => (
        <div key={group.title} data-testid={`group-details-${group.title}`}>
          <h3 className="text-sm font-semibold mb-2">{group.title}</h3>
          <div className="divide-y rounded-md border">
            {group.rows.map((row, i) => (
              <div
                key={`${row.label}-${i}`}
                className="p-2 text-sm"
                data-testid={`row-details-${row.label}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {row.priority && row.priority !== "info" && (
                    <PriorityIcon priority={row.priority} />
                  )}
                  <span className="font-mono font-medium">{row.label}</span>
                  {row.badges?.map((badge) => (
                    <Badge
                      key={badge}
                      variant={badge === "unset" ? "secondary" : "outline"}
                      className="text-xs"
                    >
                      {badge}
                    </Badge>
                  ))}
                </div>
                {row.description && (
                  <div className="text-muted-foreground">{row.description}</div>
                )}
                {row.value !== undefined && (
                  <div className="font-mono text-xs break-all mt-1">{row.value}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
