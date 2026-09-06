import { Badge } from "@/components/ui/badge";
import {
  formatInTimeZone,
  getTimeZoneOffsetLabel,
} from "@shared/utils/timezone";

export interface ZoneClockProps {
  /** What this zone IS to the reader — "Site time zone", "Your time zone". */
  title: string;
  /** The IANA name. */
  zone: string;
  /** The instant to render. Supplied by the caller so several clocks tick together. */
  at: Date;
  /** Marks the zone this person is actually being shown dates in. */
  showing?: boolean;
  /** One line of why this zone matters. */
  description?: string;
  withSeconds?: boolean;
  compact?: boolean;
  testId: string;
}

/**
 * One zone's current time, named.
 *
 * Every format call here names its zone explicitly, which is also what keeps
 * it honest: the browser's locale formatters are redirected at the display
 * zone (see `client/src/lib/display-timezone.ts`), and an explicit `timeZone`
 * is the one thing that redirection leaves alone. Without it, both clocks on
 * this screen would read the same time and the comparison the screen exists
 * to make would be invisible.
 */
export function ZoneClock({
  title,
  zone,
  at,
  showing,
  description,
  withSeconds = true,
  compact = false,
  testId,
}: ZoneClockProps) {
  const time = formatInTimeZone(at, zone, {
    hour: "numeric",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  });
  const date = formatInTimeZone(at, zone, {
    weekday: compact ? "short" : "long",
    month: compact ? "short" : "long",
    day: "numeric",
    year: "numeric",
  });
  const offset = getTimeZoneOffsetLabel(zone, at);

  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {showing && (
          <Badge variant="secondary" data-testid={`${testId}-showing`}>
            dates shown in this zone
          </Badge>
        )}
      </div>
      <p
        className={`font-mono tabular-nums ${compact ? "text-xl" : "text-3xl"}`}
        data-testid={`${testId}-time`}
      >
        {time}
      </p>
      <p className="text-sm text-muted-foreground" data-testid={`${testId}-date`}>
        {date}
      </p>
      <p className="text-xs font-mono text-muted-foreground" data-testid={`${testId}-zone`}>
        {zone}
        {offset && ` · ${offset}`}
      </p>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
