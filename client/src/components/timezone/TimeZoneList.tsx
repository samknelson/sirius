import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  getTimeZoneOffsetLabel,
  listSelectableTimeZones,
} from "@shared/utils/timezone";
import { getBrowserTimeZone } from "@/lib/display-timezone";

/**
 * How many zones to render at once. The full IANA list is several hundred
 * entries and this list is not virtualised, so a long tail is traded for a
 * prompt one: matches beyond this are reachable by typing more, and the list
 * says so rather than silently stopping.
 */
const MAX_ROWS = 60;

export interface TimeZoneListProps {
  /** The chosen zone, or null when none is chosen. */
  value: string | null;
  /**
   * Wording for the row that chooses NO zone. What that means is a property
   * of the surface, not of the list: for a person it is "wherever this
   * browser is", for a site-wide value it is "no override stored". The list
   * must be told, because guessing would state one of those on a surface
   * where it is false.
   */
  emptyOption?: { label: string; hint?: string };
  /** Called with an IANA name, or null to choose no zone. */
  onSelect: (zone: string | null) => void;
  saving?: boolean;
  testId: string;
}

/**
 * Pick a time zone, inline.
 *
 * Rendered in place rather than inside its own popover on purpose: its callers
 * include a popover panel in the header, and a portalled dropdown opened from
 * inside another portalled surface dismisses its parent on the first click.
 *
 * cmdk's own filtering is off — the rows are already narrowed here so that the
 * cap above applies to what matched, not to what happens to be first
 * alphabetically.
 */
export function TimeZoneList({
  value,
  emptyOption,
  onSelect,
  saving = false,
  testId,
}: TimeZoneListProps) {
  const [term, setTerm] = useState("");
  // The one place in the app that names the browser's own zone, and the only
  // one that has a reason to: "automatic" is a promise about a value the
  // reader cannot otherwise see, so choosing it blind would be choosing
  // nothing in particular. Everywhere else the browser's zone is an input to
  // the resolver, never something shown — see
  // `@/components/timezone/zone-vocabulary`.
  const empty = emptyOption ?? {
    label: "Automatic — wherever this browser is",
    hint: `currently ${getBrowserTimeZone()}`,
  };
  const zones = useMemo(() => listSelectableTimeZones(), []);
  const now = useMemo(() => new Date(), []);

  const needle = term.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle === ""
        ? zones
        : zones.filter((zone) => zone.toLowerCase().includes(needle)),
    [zones, needle],
  );
  const shown = matches.slice(0, MAX_ROWS);
  const hiddenCount = matches.length - shown.length;

  return (
    <Command shouldFilter={false} data-testid={testId}>
      <CommandInput
        value={term}
        onValueChange={setTerm}
        placeholder="Search time zones…"
        data-testid={`${testId}-search`}
      />
      <CommandList>
        <CommandGroup>
          <CommandItem
            value="__none__"
            onSelect={() => onSelect(null)}
            disabled={saving}
            data-testid={`${testId}-none`}
          >
            {value === null ? (
              <Check className="mr-2 h-4 w-4 shrink-0" />
            ) : (
              <span className="mr-2 h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="truncate">{empty.label}</div>
              {empty.hint && (
                <div className="truncate text-xs text-muted-foreground font-mono">
                  {empty.hint}
                </div>
              )}
            </div>
          </CommandItem>
        </CommandGroup>

        {/* A runtime without `Intl.supportedValuesOf` can still be TOLD a zone,
            it just cannot enumerate them. Say that, rather than showing an
            empty list that reads as "there are none". */}
        {zones.length === 0 && (
          <div
            className="px-3 py-4 text-sm text-muted-foreground"
            data-testid={`${testId}-unavailable`}
          >
            This browser cannot list the available time zones, so the option
            above is the only one that can be chosen here.
          </div>
        )}

        {zones.length > 0 && shown.length === 0 && (
          <CommandEmpty data-testid={`${testId}-empty`}>
            No time zone matches “{term.trim()}”.
          </CommandEmpty>
        )}

        {shown.length > 0 && (
          <CommandGroup heading="Time zones">
            {shown.map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                onSelect={() => onSelect(zone)}
                disabled={saving}
                data-testid={`${testId}-option`}
              >
                {value === zone ? (
                  <Check className="mr-2 h-4 w-4 shrink-0" />
                ) : (
                  <span className="mr-2 h-4 w-4 shrink-0" />
                )}
                <span className="truncate flex-1">{zone}</span>
                <span className="ml-2 shrink-0 text-xs font-mono text-muted-foreground">
                  {getTimeZoneOffsetLabel(zone, now)}
                </span>
              </CommandItem>
            ))}
            {hiddenCount > 0 && (
              <div
                className="px-2 py-1 text-xs text-muted-foreground"
                data-testid={`${testId}-truncated`}
              >
                {hiddenCount} more — keep typing to narrow it down.
              </div>
            )}
          </CommandGroup>
        )}
      </CommandList>
      {saving && (
        <div
          className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground"
          data-testid={`${testId}-saving`}
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </div>
      )}
    </Command>
  );
}
