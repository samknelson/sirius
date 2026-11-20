import type { ReadOnlyStorage } from "../../../storage/read-only";
import type { TrustProviderEdiContext } from "./registry";
import { COVERAGE_LIMITS, type CoverageBudget } from "./coverage-budget";
import { coverageDatabaseFailure } from "./coverage-database-error";

type ReadClient = Parameters<Parameters<ReadOnlyStorage["query"]>[0]>[0];
type TerminationRead =
  | "Selecting termination events"
  | "Reading last-covered rows"
  | "Reading historical relationships"
  | "Reading historical subscriber rows"
  | "Reading continuation scan summaries"
  | "Resolving source worker NID";

/** Static labels only: never log SQL, parameters, summaries or person identifiers. */
export async function readTerminationQuery<T>(
  ctx: TrustProviderEdiContext,
  operation: TerminationRead,
  read: (db: ReadClient) => Promise<T>,
  budget?: CoverageBudget,
): Promise<T> {
  const started = performance.now();
  budget?.log("query-start", operation);
  try {
    const result = await ctx.storage.readOnly.query(read, { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
    budget?.log("query-end", operation, {
      milliseconds: Math.round(performance.now() - started),
      ...(Array.isArray(result) ? { returnedRows: result.length } : {}),
    });
    return result;
  } catch (error) {
    throw coverageDatabaseFailure(error, `Reading termination evidence / ${operation}`,
      Math.round(performance.now() - started), ctx.coverageCorrelation);
  }
}
