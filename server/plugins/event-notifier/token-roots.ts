import { EVENT_ROOT_NAME } from "../tokens/plugins/event";
import { CONTACT_ROOT_NAME } from "../tokens/plugins/contact";
import { SYSTEM_ROOT_NAME } from "../tokens/plugins/system";

/**
 * The complete list of roots a token-templated notifier's authors may
 * write tokens from, in the order they see them.
 *
 * Every surface of that notifier is built from THIS list — the token
 * browser, the flat catalog, the seed panel and the save-time
 * validation — so what the editor offers, what it accepts and what the
 * preview reports can't disagree with each other.
 *
 * It is the notifier's own declared record roots (declaration order is
 * author-visible: a notifier leads with the record its messages are
 * about), then:
 *
 * - the event envelope, which the framework seeds for every
 *   token-templated notifier;
 * - the recipient contact, which delivery resolves for every message; and
 * - the seedless system values (`{{system.base_url}}`, today's date).
 *   Links no longer come from there: a record that has a page offers
 *   its own `{{x.url}}` / `{{x.path}}`.
 *
 * The recipient-side roots that hang off a contact (worker, employer)
 * are NOT here: delivery resolves them from the recipient, so as roots
 * of their own they would let an author write — and preview — a pairing
 * no message can be sent as. They stay reachable from a root that is
 * here, e.g. `{{worker.home_employer}}` under a worker record root.
 */
export function notifierTokenRootNames(
  declaredRoots: readonly { name: string }[],
): string[] {
  const names = [
    ...declaredRoots.map((root) => root.name),
    EVENT_ROOT_NAME,
    CONTACT_ROOT_NAME,
    SYSTEM_ROOT_NAME,
  ];
  return names.filter((name, i) => names.indexOf(name) === i);
}
