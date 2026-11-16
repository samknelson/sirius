# Employer payment permission cutover

Employer self-service payment authority is now permission plus current contact
assignment, not a flag on each employer-contact link.

- `employer.ledger.pay` becomes `employer.ledger.pay.own`.
- `employer.ledger.methods` becomes `employer.ledger.methods.manage.own`.
- Each permission covers **all employers currently assigned to the effective
  user's resolved contact**, regardless of former grant flags. This deliberately
  removes employer-by-employer distinctions. Review role assignments accordingly.
- Pay-only contacts may use existing methods or pay once with a new method.
  Saving, removing, or changing defaults requires the separate methods permission.
  Method management alone does not authorize payment.
- Contact type (including Billing), assignment alone, permission alone, and
  staff/admin identity alone do not authorize these own-scoped operations.
- Assignment removal blocks subsequent sensitive operations, including those
  requested from an already-open checkout. Masquerading uses the effective
  user's identity, permissions, and contact, not the original staff identity.

Administrators use existing role administration to assign the permissions and
normal employer-contact administration to maintain assignments. There is no
Payment Authority editor or replacement grant flag. Worker self-service and the
separate administrator-on-behalf payment workflow are unchanged.

## Upgrade and fresh startup

Migration 1221 runs transactionally and is safe to replay. Existing roles retain
their memberships; old permission rows are copied to their replacements without
duplicates, preserving an already-existing replacement row, then old keys are
removed. No roles, role memberships, or permissions are created from grant rows.
The obsolete grant table is dropped without CASCADE. Payment attempts, saved
methods, financial records, entity metadata, and audit history are not changed.
Historical migrations remain intact: a fresh database can create the old table
before this migration retires it. The migration also tolerates the old table
already being absent, and does not depend on enabled optional components.

The current stored-key inventory found old keys only in role permissions, not
in development variables or plugin configuration data. Source consumers now use
the replacement policies. Organization-specific external configuration using
these literal keys should use the replacements as well.

Built-in help retains `system:online-payment-checkout` at its existing `/pay/`
checkout patterns. Local help rows are not changed.
