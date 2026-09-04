/**
 * The BTU cardcheck scrape's outbound operations.
 *
 * The scrape drives a browser against the BTU site rather than calling an API,
 * which makes no difference to what the framework is for: it is still this
 * installation reaching out to somebody else's system, and during maintenance
 * it is refused with the same wording as any other.
 *
 * Registered here rather than beside either scrape because the same two
 * operations are performed by two callers — the admin import routes and the
 * cardcheck scrape-import wizard — and one shared registration is what keeps
 * their behavior from drifting apart. Each caller still makes its own request
 * through the framework; only the declaration is shared.
 *
 * Both need a writable database. A scrape run exists to write: it pulls a
 * signature PDF per card check and files it against an e-signature record. A
 * run that cannot write records nothing, so it would fetch every PDF again on
 * the next attempt, and the login it started with would have been spent for
 * nothing too.
 */
import { registerUncachedWcRequest } from "../../../services/webclient";

export const BTU_SCRAPE_LOGIN = "login";
export const BTU_SCRAPE_FETCH_CARDCHECK = "fetch-cardcheck";

registerUncachedWcRequest({
  service: "BTU",
  requestType: BTU_SCRAPE_LOGIN,
  operation: "sign in to the BTU site",
  needsWritableDatabase: true,
});

registerUncachedWcRequest({
  service: "BTU",
  requestType: BTU_SCRAPE_FETCH_CARDCHECK,
  operation: "fetch a card check page from the BTU site",
  needsWritableDatabase: true,
});
