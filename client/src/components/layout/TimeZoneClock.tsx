import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ZoneClock } from "@/components/timezone/ZoneClock";
import { describeTimeZones } from "@/components/timezone/zone-vocabulary";
import { TimeZoneList } from "@/components/timezone/TimeZoneList";
import { useAuth } from "@/contexts/AuthContext";
import { useNow } from "@/hooks/use-now";
import {
  ApiError,
  apiRequest,
  queryClient,
  getApiErrorMessage,
} from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatInTimeZone } from "@shared/utils/timezone";

/**
 * The clock in the header, and the panel behind it.
 *
 * It exists because every date on the site is rendered in SOME zone and, until
 * now, nothing on screen said which — two people in different places read
 * different numbers for the same event with nothing to explain the difference.
 * The clock is that explanation: whatever it reads is the zone the dates
 * beside it are in.
 *
 * So it must show USER time specifically — the zone dates are actually being
 * rendered in. The panel behind it puts that beside SYSTEM time, which is the
 * only other zone this site has; both are named and described by
 * `@/components/timezone/zone-vocabulary`, shared with the settings screen so
 * the two surfaces cannot describe the same situation differently.
 */
export function TimeZoneClock() {
  const { timezone, displayTimeZone } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const now = useNow(1000);

  const allowed = timezone.allowUserTimezones;
  const zones = describeTimeZones({
    systemTimeZone: timezone.systemTimeZone,
    userTimeZone: timezone.userTimeZone,
    allowUserTimezones: allowed,
    displayTimeZone,
    testIdPrefix: "clock-panel",
  });

  // Reopening should start from the summary, not from wherever the last visit
  // was left.
  useEffect(() => {
    if (!open) setPicking(false);
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async (zone: string | null) =>
      apiRequest("PUT", "/api/users/me/timezone", { timezone: zone }),
    onSuccess: async (_data, zone) => {
      setPicking(false);
      // The auth payload carries the zone, and AuthContext remounts the tree
      // when the resolved display zone changes — which is what makes the dates
      // already on screen follow the choice instead of waiting for the next
      // navigation. This component is inside that tree and goes with it, so
      // the panel closes on its own; the toast survives because the toast
      // store lives outside React.
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/me/timezone"] });
      toast({
        title: "Time zone saved",
        description:
          zone === null
            ? "Dates now follow wherever this browser is."
            : `Dates are now shown in ${zone}.`,
      });
    },
    onError: (error: Error) => {
      // A 403 here means the site turned personal zones off while this page
      // was open — the panel is running on a cached auth payload that still
      // says they are allowed. The refusal is the moment we learn better, so
      // re-read the payload: the picker closes and comes back disabled with
      // its explanation, instead of the person clicking into an error again.
      if (error instanceof ApiError && error.status === 403) {
        setPicking(false);
        void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        toast({
          title: "Personal time zones are turned off",
          description:
            "This site now shows everyone dates and times in the site's time zone.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Could not save your time zone",
        description: getApiErrorMessage(error, "Request failed"),
        variant: "destructive",
      });
    },
  });

  const triggerTime = formatInTimeZone(now, displayTimeZone, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 font-normal text-muted-foreground"
          aria-label={`Current time ${triggerTime} in ${displayTimeZone}. Open time zone settings.`}
          data-testid="button-timezone-clock"
        >
          <Clock className="h-4 w-4" />
          <span className="tabular-nums" data-testid="text-timezone-clock">
            {triggerTime}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-80 p-0"
        data-testid="panel-timezone-clock"
      >
        <div className="space-y-4 p-4">
          {/* Two clocks, always the same two, whatever the policy says. A
              third — where this browser happens to be — would be a zone the
              reader cannot act on and, with personal zones off, one that
              governs nothing here. */}
          <ZoneClock
            title={zones.system.title}
            zone={zones.system.zone}
            at={now}
            compact
            showing={zones.system.showing}
            description={zones.system.description}
            testId={zones.system.testId}
          />
          <Separator />
          <ZoneClock
            title={zones.user.title}
            zone={zones.user.zone}
            at={now}
            compact
            showing={zones.user.showing}
            description={zones.user.description}
            testId={zones.user.testId}
          />
          <p
            className="text-xs text-muted-foreground"
            data-testid="text-timezone-panel-summary"
          >
            {zones.summary}
          </p>
        </div>

        <Separator />

        {picking ? (
          <TimeZoneList
            value={timezone.userTimeZone}
            onSelect={(zone) => saveMutation.mutate(zone)}
            saving={saveMutation.isPending}
            testId="timezone-panel-list"
          />
        ) : (
          <div className="space-y-2 p-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!allowed}
              onClick={() => setPicking(true)}
              data-testid="button-timezone-change"
            >
              {!allowed && <Lock className="mr-2 h-3.5 w-3.5" />}
              Change my time zone
            </Button>
            {/* Disabled and explained rather than hidden: someone who was told
                they could pick a zone needs to learn that the site turned it
                off, not silently find the control missing. Why user time is
                system time here is said once, in the summary above; this line
                only answers who can change that. */}
            {!allowed && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-timezone-personal-disabled"
              >
                An administrator turns personal time zones on for the whole
                site.
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
