/**
 * The words for the two time zones this site has, in one place.
 *
 * There are exactly two, and every screen must speak of exactly these:
 *
 *  - SYSTEM time — the zone the server runs in. What a stored timestamp means,
 *    when scheduled work fires, where the day ends.
 *  - USER time — the zone this person is shown dates in. Decided by
 *    `resolveEffectiveTimeZone` in `shared/utils/timezone.ts`: system time
 *    when the site has personal
 *    zones switched off, otherwise the zone they chose, otherwise the zone
 *    their browser reports.
 *
 * The browser's zone is an INPUT to that last case, not a third zone. It is
 * deliberately absent from everything below: a card showing it states a fact
 * the reader cannot act on and, when personal zones are off, one that governs
 * nothing on the site. The one place it is still named is the picker's
 * "automatic" row, which has to say what automatic would resolve to.
 *
 * Both surfaces that show clocks — the settings screen and the header panel —
 * render from this function, so they cannot drift into describing the same
 * situation in two different vocabularies. That drift is the whole reason this
 * module exists: the two screens previously disagreed about what to call the
 * reader's own zone, and one of them was wrong.
 */

/** One clock, fully described. */
export interface ZoneCard {
  /** The zone's name in the site's vocabulary. */
  title: string;
  /** The IANA name to render. */
  zone: string;
  /** What this zone governs, or where it came from. */
  description: string;
  /** Whether to mark this as the zone dates are rendered in. */
  showing: boolean;
  testId: string;
}

export interface ZoneVocabulary {
  system: ZoneCard;
  user: ZoneCard;
  /** Whether the two are the same zone. */
  sameZone: boolean;
  /** One line naming the relationship between them, for below the clocks. */
  summary: string;
}

export interface DescribeTimeZonesInput {
  /** The zone the server runs in, as published by the server. */
  systemTimeZone: string;
  /** This person's own recorded zone, or null when they have not chosen one. */
  userTimeZone: string | null;
  /** Whether site policy honours a personal zone at all. */
  allowUserTimezones: boolean;
  /**
   * The already-resolved display zone, from `useAuth()`. Passed in rather than
   * re-derived here so there is still exactly ONE resolver: a second
   * resolution site is how a screen ends up describing a zone that is not the
   * one its dates are actually in.
   */
  displayTimeZone: string;
  /** Namespaces the test ids, so two surfaces can render this at once. */
  testIdPrefix: string;
}

const SYSTEM_DESCRIPTION =
  "What every stored date and time means, when scheduled work fires, and where the day ends.";

export function describeTimeZones(input: DescribeTimeZonesInput): ZoneVocabulary {
  const {
    systemTimeZone,
    userTimeZone,
    allowUserTimezones,
    displayTimeZone,
    testIdPrefix,
  } = input;

  const sameZone = displayTimeZone === systemTimeZone;

  // Whether the choice was HONOURED, not merely whether one is stored. The
  // resolver ignores a stored zone it cannot use — an unrecognised name, one
  // left behind by a renamed IANA zone — and falls back to the browser's,
  // which would otherwise be described as "the zone you chose" while being
  // nothing of the kind. Read off the outcome rather than re-testing the
  // stored value, so this cannot drift from what the resolver actually did.
  const choiceHonoured = userTimeZone !== null && displayTimeZone === userTimeZone;

  const userDescription = !allowUserTimezones
    ? "Personal time zones are off for this site, so this is system time."
    : choiceHonoured
      ? "The zone you chose for yourself."
      : "Automatic — the zone this browser reports.";

  const summary = !allowUserTimezones
    ? "Personal time zones are off, so user time is system time: everyone here reads the same clock."
    : sameZone
      ? "Your time zone is the site's own, so the two agree and there is nothing to reconcile."
      : "Dates and times here are shown in user time. System time is what they mean once stored.";

  return {
    system: {
      title: "System time",
      zone: systemTimeZone,
      description: SYSTEM_DESCRIPTION,
      // Badging both when they are the same zone reads as two different
      // answers to "which one am I seeing?", so the badge marks the user clock
      // only when there is something to distinguish. When they coincide the
      // summary line says so outright.
      showing: false,
      testId: `${testIdPrefix}-system`,
    },
    user: {
      title: "User time",
      zone: displayTimeZone,
      description: userDescription,
      showing: !sameZone,
      testId: `${testIdPrefix}-user`,
    },
    sameZone,
    summary,
  };
}
