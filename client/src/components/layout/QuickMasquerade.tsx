import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, UserCog } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";

type Target = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};
type Recent = Omit<Target, "id"> & { userId: string; timestamp: string };

function TargetLabel({ target }: { target: Target }) {
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className="truncate font-medium">
        {[target.firstName, target.lastName].filter(Boolean).join(" ") || "No name"}
      </span>
      <span className="truncate text-xs text-muted-foreground">{target.email || "No email"}</span>
    </span>
  );
}

export function QuickMasquerade() {
  const { user, hasPermission, masquerade, stopMasquerade } = useAuth();
  const active = masquerade.isMasquerading;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Target[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const { data: recents, isLoading: loadingRecent, isError: recentError } = useQuery<{ recentMasquerades: Recent[] }>({
    queryKey: ["/api/auth/masquerade/recent", user?.id],
    enabled: open && !active,
    staleTime: 0,
    queryFn: async () => {
      const response = await fetch("/api/auth/masquerade/recent", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load recent users");
      return response.json();
    },
  });

  useEffect(() => {
    if (!open || active || search.trim().length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setResults([]);
    setSearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/auth/masquerade/search?q=${encodeURIComponent(search.trim())}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to search users");
        const users: (Target & { isActive: boolean })[] = await response.json();
        setResults(users.filter((candidate) => candidate.isActive));
      } catch (cause) {
        if (!controller.signal.aborted) setSearchError("Could not search users. Try again.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, open, active]);

  if (!user || (!active && !hasPermission("masquerade") && !hasPermission("admin"))) return null;

  const changeOpen = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setSearch("");
      setError("");
    }
  };

  const start = async (userId: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await apiRequest("POST", "/api/auth/masquerade/start", { userId });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.href = "/";
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Failed to start masquerade"));
      submitting.current = false;
      setPending(false);
    }
  };

  const stop = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await stopMasquerade();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to stop masquerade");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Masquerade" title="Masquerade"
          data-testid="button-quick-masquerade">
          <UserCog className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1rem))] max-h-[min(32rem,calc(100vh-5rem))] overflow-y-auto space-y-3">
        <h2 className="text-sm font-semibold">{active ? "Masquerading" : "Masquerade as a user"}</h2>
        {active ? (
          <Button className="w-full" variant="outline" onClick={stop} disabled={pending}
            data-testid="quick-stop-masquerade">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? "Stopping..." : "Stop Masquerading"}
          </Button>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-xs font-medium">Recent users</p>
              {loadingRecent ? <p className="text-sm text-muted-foreground" role="status">Loading recent users...</p>
                : recentError ? <p className="text-sm text-destructive" role="alert">Could not load recent users.</p>
                : !recents?.recentMasquerades.length ? <p className="text-sm text-muted-foreground">No recent users.</p>
                : recents.recentMasquerades.slice(0, 3).map((recent) => (
                  <button key={recent.userId} type="button" disabled={pending} onClick={() => start(recent.userId)}
                    data-testid={`quick-recent-${recent.userId}`}
                    className="w-full rounded-sm px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                    <TargetLabel target={{ ...recent, id: recent.userId }} />
                  </button>
                ))}
            </div>
            <div className="space-y-1">
              <label htmlFor="quick-masquerade-search" className="text-xs font-medium">Search users by email</label>
              <Input id="quick-masquerade-search" value={search} onChange={(event) => setSearch(event.target.value)}
                placeholder="Enter at least 2 characters" disabled={pending} autoComplete="off"
                data-testid="quick-masquerade-search" />
              {search.trim().length >= 2 && (
                <div role="status" aria-live="polite" className="max-h-48 overflow-y-auto">
                  {searching ? <p className="text-sm text-muted-foreground">Searching...</p>
                    : searchError ? <p className="text-sm text-destructive">{searchError}</p>
                    : results.length === 0 ? <p className="text-sm text-muted-foreground">No active users found.</p>
                    : results.map((target) => (
                      <button key={target.id} type="button" disabled={pending} onClick={() => start(target.id)}
                        data-testid={`quick-result-${target.id}`}
                        className="w-full rounded-sm px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                        <TargetLabel target={target} />
                      </button>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
        {pending && <p role="status" className="text-sm text-muted-foreground">
          {active ? "Returning to your account..." : "Starting masquerade..."}
        </p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}