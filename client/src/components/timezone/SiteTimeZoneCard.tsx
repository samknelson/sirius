import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Power } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeZoneList } from "@/components/timezone/TimeZoneList";
import { EnvVariableRow, type EnvValueEditorProps } from "@/components/env/EnvVariableRow";
import { useEnvVariables } from "@/components/env/use-env-variables";
import { isValidTimeZone, listSelectableTimeZones } from "@shared/utils/timezone";

/** The environment variable that holds the site's zone. */
export const SITE_TIMEZONE_VARIABLE = "TZ";

const RESTART_INFO_QUERY_KEY = ["/api/admin/restart/info"];

interface PendingRestartVariable {
  name: string;
  description: string;
  category: string;
  secret: boolean;
  change: string;
}

interface RestartInfo {
  pendingRestartVariables?: PendingRestartVariable[];
  pendingRestartKnown?: boolean;
}

/**
 * Choosing the site's zone.
 *
 * A site-wide zone is not "automatic" and it is not this browser's: choosing
 * nothing here means no override is stored, and the site then runs in
 * whatever zone the container itself starts in. The list is told that in so
 * many words, because the same list also serves a personal choice where the
 * empty row means something else entirely.
 *
 * A runtime that cannot enumerate zones can still be TOLD one, so the fallback
 * is a name typed by hand — with the same refusal in both cases, since an
 * unrecognised zone does not merely display oddly, it stops the app from
 * starting.
 */
function SiteTimeZoneValueEditor({
  value,
  onChange,
  onClear,
  canClear,
  saving,
  clearing,
}: EnvValueEditorProps) {
  const zones = useMemo(() => listSelectableTimeZones(), []);
  const unrecognised = value !== "" && !isValidTimeZone(value);

  if (zones.length === 0) {
    return (
      <div className="space-y-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="America/New_York"
          className="font-mono text-sm"
          data-testid="input-site-timezone"
        />
        <p className="text-xs text-muted-foreground">
          This browser cannot list the available time zones, so type an IANA
          name such as <code className="font-mono">America/New_York</code>.
        </p>
        {unrecognised && (
          <p className="text-xs text-destructive" data-testid="text-site-timezone-unrecognised">
            This runtime does not recognise that time zone, so it cannot be
            saved — a zone the app does not understand stops it from starting.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <TimeZoneList
        value={value === "" ? null : value}
        emptyOption={{
          label: "No override stored — the container's own zone",
          hint: canClear ? "clears the stored value" : "how it is set now",
        }}
        onSelect={(zone) => {
          // The empty row is not a value that can be saved: it is the ABSENCE
          // of one, which is what clearing the override produces.
          if (zone === null) {
            if (canClear) onClear();
            return;
          }
          onChange(zone);
        }}
        saving={saving || clearing}
        testId="timezone-site-list"
      />
    </div>
  );
}

/**
 * The site's time zone: what it costs, and where it is set.
 *
 * The value is edited HERE, where its consequences are spelled out, rather
 * than on a page that lists it beside eighty other variables — but it is
 * edited through the same component that page renders, so the badges, the
 * locked explanation and the write calls are literally the same ones. This
 * card adds only what is specific to the zone: the warning about re-reading
 * history, and whether a saved change is still waiting on a restart.
 */
export function SiteTimeZoneCard({ systemTimeZone }: { systemTimeZone: string }) {
  const [editing, setEditing] = useState(false);

  // Whether the site zone has been changed but not yet picked up. TZ is read
  // once while the process starts, so a saved change sits inert until then and
  // this page would otherwise show a site clock that disagrees with the value
  // an admin just saved.
  const { data: restartInfo } = useQuery<RestartInfo>({
    queryKey: RESTART_INFO_QUERY_KEY,
    retry: false,
    staleTime: 30 * 1000,
  });

  const env = useEnvVariables({
    // Storing the value is exactly what makes a restart pending, so the alert
    // below must be re-asked at the same moment — otherwise it appears only
    // on the next reload, after the admin has stopped looking.
    onWrite: () => {
      queryClient.invalidateQueries({ queryKey: RESTART_INFO_QUERY_KEY });
    },
  });
  const variable = env.variables?.find((v) => v.name === SITE_TIMEZONE_VARIABLE);

  const pendingSiteZone = restartInfo?.pendingRestartVariables?.find(
    (v) => v.name === SITE_TIMEZONE_VARIABLE,
  );
  // A process that never recorded a baseline cannot answer the question at
  // all. Silence would read as "nothing is pending", which is the one thing it
  // does not know — say so instead. Nothing is claimed while the query is
  // still in flight or was refused.
  const pendingUnknown = restartInfo?.pendingRestartKnown === false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>The site's time zone</CardTitle>
        <CardDescription>
          Currently{" "}
          <code className="font-mono" data-testid="text-site-timezone">
            {systemTimeZone}
          </code>
          , from the <code className="font-mono">{SITE_TIMEZONE_VARIABLE}</code>{" "}
          environment variable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Said here, where the change is made, because the consequence is
            not reversible by simply changing it back: the same stored rows
            will have been read and acted on in the meantime. */}
        <Alert variant="destructive" data-testid="alert-timezone-consequences">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Changing this re-interprets history</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Dates and times are stored as a wall-clock reading with no zone
              attached, so they mean whatever zone the site is set to. Move
              the site's zone and every date already stored moves with it: a
              shift recorded at 8:00 AM still reads 8:00 AM, but it is now a
              different moment. Nothing is converted, and there is no record
              of the old reading.
            </p>
            <p>
              The new value is read only while the app is starting, so it
              takes effect on the next restart — not when it is saved.
            </p>
          </AlertDescription>
        </Alert>

        {env.isLoading && <Skeleton className="h-24 w-full" />}

        {/* The variable is read through the admin environment listing, which
            can be refused or can simply not carry TZ. Neither is an editor
            that quietly does nothing — say which one happened, and point at
            the page that can still answer. The site clock above is unaffected:
            it is what the process is running in, not what is stored. */}
        {!env.isLoading && !variable && (
          <Alert data-testid="alert-timezone-variable-unavailable">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {SITE_TIMEZONE_VARIABLE} cannot be read here
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {env.isError
                  ? "The list of environment variables could not be loaded, so this card cannot say how the site's zone is set or offer to change it."
                  : `${SITE_TIMEZONE_VARIABLE} is not among the registered environment variables, so there is nothing here to edit.`}{" "}
                The clock above is still the zone this process is actually
                running in.
              </p>
              <div>
                <Link href="/config/env">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="link-timezone-env-fallback"
                  >
                    Environment Variables
                    <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {variable && (
          <div className="rounded-md border px-4">
            <EnvVariableRow
              variable={variable}
              editing={editing}
              onEditingChange={setEditing}
              saveOverride={env.saveOverride}
              clearOverride={env.clearOverride}
              saving={env.isSaving}
              clearing={env.isClearing}
              renderValueEditor={(props) => <SiteTimeZoneValueEditor {...props} />}
              canSaveValue={isValidTimeZone}
            />
          </div>
        )}

        {pendingSiteZone && (
          <Alert data-testid="alert-timezone-pending-restart">
            <Power className="h-4 w-4" />
            <AlertTitle>A new site time zone is waiting on a restart</AlertTitle>
            <AlertDescription>
              <code className="font-mono">{SITE_TIMEZONE_VARIABLE}</code> was{" "}
              {pendingSiteZone.change} since this app started, so the clock
              above is still the old zone. Restart to apply it.
              <div className="mt-2">
                <Link href="/admin/restart">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="link-timezone-restart"
                  >
                    Restart &amp; Reload
                    <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {pendingUnknown && (
          <Alert data-testid="alert-timezone-pending-unknown">
            <Power className="h-4 w-4" />
            <AlertTitle>
              Whether a new time zone is waiting cannot be determined
            </AlertTitle>
            <AlertDescription>
              This process did not reach the point where it records a
              baseline, so it cannot tell whether{" "}
              <code className="font-mono">{SITE_TIMEZONE_VARIABLE}</code> has
              been edited since it started. If it has, the site clock above
              is still the old zone.
            </AlertDescription>
          </Alert>
        )}

        {variable && (
          <p className="text-sm text-muted-foreground">
            The value is stored with the other environment variables, where it
            can also be seen alongside them on{" "}
            <Link
              href="/config/env"
              className="underline underline-offset-2"
              data-testid="link-timezone-env"
            >
              Environment Variables
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
