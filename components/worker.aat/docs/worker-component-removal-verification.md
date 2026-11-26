# Worker component removal verification

## Scope and isolation

Verification used a separate source checkout with its own Git snapshot and
isolated PostgreSQL databases. Removal tests physically parked component
directories, regenerated discovery bridges, and ran the complete application to
ready state. They did not change the shared workspace's component switches.
Outbound vendor traffic was blocked in the isolated processes.

The temporary removal and browser harnesses are not a permanent test suite.
Existing focused tests and narrowly scoped regression tests remain in their
normal locations.

## Source removal cases

Discovery, typecheck, architecture lint, production build, and complete startup
passed for these valid removal groups:

| Requested removal | Required removal group |
| --- | --- |
| `worker.login` | Login alone |
| `worker.skills` | Skills and certifications |
| `worker.certifications` | Certifications alone |
| `worker.badges` | Badges alone |
| `worker.ratings` | Ratings alone |
| `worker.relations` | Relations alone |
| `worker.steward` | Steward alone |
| `worker.tos` | TOS and the declared T631 client dependency closure |
| `worker.aat` | AAT and the declared T631 client dependency closure |
| All nine workers | All nine and their declared reverse-dependency closure |

Removing skills, TOS, or AAT while retaining a required dependent failed at
discovery with the missing dependency identified. The closures were derived from
the final declarations, not assumed to be independent singleton deletions.

Restoration, retained-enabled data, retained-disabled data, missing component
state, and fresh databases without the removed tables were also exercised.
Retained worker rows, options, plugin configurations, role authority, component
switches, and the TOS banner setting were compared across removal and
restoration. Retained credential rows were not cleared or regenerated.

## Installed and unavailable behavior

- Certification grants and revocations updated skill facts and actual dispatch
  eligibility. Unmanaged manual skills were preserved. As before, a skill
  referenced by any certification option belongs to the certification-managed
  set; this extraction does not introduce per-award source tracking.
- Actual new/edit-page slot composition has two focused regression checks.
  Skills mount only once per form. A signed-in production browser changed
  required skills on an existing job, saved, and reloaded the persisted result.
  With skills disabled, an unrelated job edit preserved the saved skills and
  other extension data without mounting skill controls.
- The EDLS directory applied rating filters. Disabled or absent ratings removed
  rating controls, while explicit rating requests were refused.
- A configured skill eligibility workflow failed rather than reporting success
  when its owner was disabled or absent.
- Dependent eligibility required relationship authority before the no-rules
  shortcut. Subscriber/self eligibility remained available without it.
  When a relationship rule is configured, disabling its owner instead refuses
  subscriber/self eligibility too. Eight focused regressions exercise the
  production evaluator used by the API and scans, including continuation,
  short-circuiting, installed self rules, and missing-source behavior.
- Steward assignments, organizing-report data, building-representative contact
  lookup, and skill source-navigation contracts were exercised.
- TOS conflicts retained their conflict response. T631 TOS synchronization
  refused before writes when TOS was unavailable.
- Anonymous bearer schedule requests accepted only the actual credential.
  Answers enforced the current assignment generation, rejected repeat answers
  and stale generations, and rejected both reads and answers after revocation.
- Focused T631 arrival tests covered early refusal before vendor access and a
  second availability check after the remote response.

The focused installed test runs passed **236 tests** across the worker,
dispatch, EDLS, bring-up, source-navigation, charge-availability, and T631
arrival cases.

## Browser and application checks

The actual proxied development entry initialized with HMR connected and without
uncaught browser errors. The shared workspace's signed-in UI was not inspected.

Production-format signed-in checks used an isolated local-auth account and real
sign-in, without bypassing authorization. Skills, certifications, badges,
ratings, relations, steward, and TOS screens rendered; the EDLS rating selector
offered its configured choices; the public schedule rendered. Disabled and
source-absent checks retained core worker/EDLS screens without unavailable owner
navigation or rating controls.

The shared development workflow was restarted after the implementation and
reached normal application startup. Migration validation also passed. No
production deployment or live vendor call was part of this verification.
