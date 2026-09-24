/**
 * The doors, shut.
 *
 * While the site is in maintenance mode every request under the web service
 * mount is refused, and refused FIRST — ahead of body parsing, ahead of
 * authentication, ahead of any database access. Nothing about the caller is
 * examined, because nothing about the caller changes the answer.
 *
 * That ordering is not tidiness, it is the only order that answers every
 * caller the same way:
 *
 * - Ahead of **authentication**, because authentication writes: it stamps the
 *   credential's `last_used_at`. Maintenance mode puts every pooled connection
 *   into a read-only transaction, so behind a later gate that write would fail
 *   and the caller would get an opaque error instead of a clear refusal.
 * - Ahead of **body parsing**, because the parser rejects too. A caller
 *   sending malformed JSON, or a body over the size limit, is answered 400 or
 *   413 by the parser before any router sees the request — and "your JSON is
 *   broken" is the wrong thing to tell someone whose real problem is that the
 *   site is down.
 *
 * It also means a refusal leaves no request-log row, because logging is a
 * write too. That is accepted: the maintenance window is its own record, and
 * widening the database escape hatch (reserved for sessions and the
 * maintenance flag) to log people we are deliberately ignoring would be a poor
 * trade.
 *
 * There is no exemption, for any operation or any client, matching the
 * outbound side — which has no vendor escape hatch either. A partner API that
 * serves reads while writes fail is worse than one cleanly down: the caller
 * cannot tell a stale read from a fresh one, and makes decisions on it.
 *
 * Because the gate must beat the base middleware, it cannot be installed by
 * the dispatcher — that runs much later. It is installed by the entry point's
 * middleware assembly instead, and {@link assertMaintenanceGateInstalled} is
 * what stops the two drifting apart: a dispatcher mounted on an app that never
 * got its gate fails at boot rather than quietly serving through maintenance.
 */
import type { Express, RequestHandler } from 'express';
import {
  MAINTENANCE_REFUSAL_STATUS,
  isMaintenanceActive,
} from '../../services/maintenance-flag';
import { WEB_SERVICE_BASE_PATH } from './base-path';

/**
 * The machine-readable reason. Deliberately NOT one of the dispatcher's
 * refusal codes: those are indistinguishable from each other on purpose, so an
 * outsider probing the URL space learns nothing. This one is the opposite —
 * every caller should be able to tell "come back later" apart from "you may
 * not call this", because only one of them is worth retrying.
 */
export const WS_MAINTENANCE_CODE = 'MAINTENANCE';

/**
 * How long to tell a caller to wait, in seconds.
 *
 * A maintenance window has no announced end, so this is not a promise — it is
 * a back-off hint that keeps a well-behaved integration from retrying in a
 * tight loop while an operator works.
 */
export const WS_MAINTENANCE_RETRY_AFTER_SECONDS = 300;

/**
 * Inbound wording, written for the integrator reading it in their own error
 * log. The outbound refusal message names a third-party service and the
 * operation we were attempting against it, which says nothing useful to
 * someone who called *us*.
 */
export const WS_MAINTENANCE_MESSAGE =
  'This site is in maintenance mode and is not accepting web service calls. Retry later.';

/** Apps that have had the gate installed, so the dispatcher can insist on it. */
const gatedApps = new WeakSet<Express>();

/**
 * Refuse everything while maintenance is on, pass everything through
 * otherwise.
 *
 * The flag is read from memory — no query, no await — so the check costs
 * nothing on the normal path.
 */
function createMaintenanceGate(): RequestHandler {
  return (_req, res, next) => {
    if (!isMaintenanceActive()) return next();

    res.setHeader('Retry-After', String(WS_MAINTENANCE_RETRY_AFTER_SECONDS));
    res.status(MAINTENANCE_REFUSAL_STATUS).json({
      error: 'Service Unavailable',
      code: WS_MAINTENANCE_CODE,
      message: WS_MAINTENANCE_MESSAGE,
    });
  };
}

/**
 * Install the gate for the web service mount. Call this BEFORE any other
 * middleware — body parsers included — and before the dispatcher is
 * registered.
 *
 * Scoped to the mount rather than the whole app: maintenance mode leaves the
 * site itself browsable, and only the web services are shut.
 */
export function installWebServiceMaintenanceGate(app: Express): void {
  if (gatedApps.has(app)) return;
  gatedApps.add(app);
  app.use(WEB_SERVICE_BASE_PATH, createMaintenanceGate());
}

/**
 * Refuse to register a dispatcher on an app whose doors have no lock.
 *
 * The gate lives at the other end of the boot sequence from the dispatcher, so
 * nothing about the dispatcher's own code reveals whether it is there. Without
 * this, dropping or reordering the install would produce an app that serves
 * every web service straight through a maintenance window, and no test of the
 * dispatcher would notice.
 */
export function assertMaintenanceGateInstalled(app: Express): void {
  if (gatedApps.has(app)) return;
  throw new Error(
    'Web service dispatcher registered on an app with no maintenance gate. ' +
      'Call installWebServiceMaintenanceGate(app) before the base middleware — ' +
      'it must run ahead of body parsing and authentication.',
  );
}
