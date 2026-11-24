import type { QueryClient, Query } from "@tanstack/react-query";

/**
 * Observes the widget's existing queries; never creates a fetching observer.
 * Registrations belong to mounted hooks, not all historical keys in the cache.
 */
export class DashboardRefreshState {
  private registrations = new Map<symbol, string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private unsubscribeCache?: () => void;
  private denied = false;

  constructor(private client: QueryClient) {}

  getSnapshot = () => this.revision;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.unsubscribeCache) {
      this.unsubscribeCache = this.client.getQueryCache().subscribe(event => {
        if (event.type === "updated" && this.hashes().has(event.query.queryHash)) {
          this.checkRefusal(event.query);
          this.changed();
        }
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.unsubscribeCache?.();
        this.unsubscribeCache = undefined;
      }
    };
  };

  register(hash: string) {
    const token = Symbol();
    this.registrations.set(token, hash);
    const query = this.client.getQueryCache().get(hash);
    if (query) this.checkRefusal(query);
    this.changed();
    return () => {
      this.registrations.delete(token);
      this.changed();
    };
  }

  private hashes() { return new Set(this.registrations.values()); }
  private changed() {
    this.revision++;
    this.listeners.forEach(listener => listener());
  }
  private checkRefusal(query: Query) {
    // null is the content hook's explicit unavailable/access-refused outcome.
    // Latch it so unmounting the protected children cannot re-open them.
    if (query.state.status === "success" && query.state.data === null) this.denied = true;
  }

  read() {
    const queries = [...this.hashes()]
      .map(hash => this.client.getQueryCache().get(hash))
      .filter((query): query is Query => !!query);
    return {
      denied: this.denied,
      count: queries.length,
      fetching: queries.some(query => query.state.fetchStatus === "fetching"),
      error: queries.some(query => query.state.status === "error"),
      lastSuccess: queries.length && queries.every(query => query.state.dataUpdatedAt > 0 && query.state.data !== null)
        ? Math.min(...queries.map(query => query.state.dataUpdatedAt))
        : 0,
    };
  }

  async refresh() {
    if (this.denied) {
      // Remount after clearing a refusal. The hook discards unmounted data and
      // performs a new authorized request; no stale protected DOM is retained.
      this.denied = false;
      this.changed();
      return;
    }
    const hashes = this.hashes();
    await this.client.refetchQueries({
      predicate: query => hashes.has(query.queryHash) && query.isActive(),
    }, { cancelRefetch: false });
  }
}
