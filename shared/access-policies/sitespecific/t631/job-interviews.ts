import { definePolicy, registerPolicy, type PolicyContext } from '../../index';

/**
 * Are T631 interviews relevant for this dispatch job at all?
 *
 * True when the job's job type has the "interview required" dispatch
 * eligibility plugin (sitespecific_t631_interview) enabled — the same
 * per-job-type plugin-config set dispatch eligibility itself uses — OR when
 * the job already has interview rows (so existing data never becomes
 * unreachable after the plugin is disabled on the job type).
 *
 * Takes the storage object (server storage or ctx.storage inside a policy)
 * so it is usable from both the shared policy and server routes.
 */
export async function jobInterviewsAvailable(
  storage: any,
  job: { id: string; jobTypeId?: string | null },
): Promise<boolean> {
  if (job.jobTypeId) {
    try {
      const rows = await storage.pluginConfigs.search('dispatch-eligibility', {
        jobType: job.jobTypeId,
      });
      if (
        rows.some(
          (r: any) =>
            r.config?.pluginId === 'sitespecific_t631_interview' && r.config?.enabled,
        )
      ) {
        return true;
      }
    } catch {
      // fall through to the interviews-exist check
    }
  }
  try {
    const existing = await storage.t631Interviews?.getByJob?.(job.id);
    return Array.isArray(existing) && existing.length > 0;
  } catch {
    return false;
  }
}

/**
 * View the T631 interviews tab of a dispatch job.
 *
 * Staff always; employer users only for jobs belonging to an employer they
 * are linked to (delegates to employer.mine). Workers do NOT get access to
 * the job-side page — they see their own interviews on their worker page.
 * The entity id is the DISPATCH JOB id.
 */
const policy = definePolicy({
  id: 'sitespecific.t631.job.interviews',
  description: 'View T631 interviews for a dispatch job',
  scope: 'entity',
  entityType: 'dispatch',
  component: 'sitespecific.t631.interviews',
  // The relevance check (interview plugin on the job type / existing rows)
  // must apply to EVERYONE, admins included — the tab is meaningless on
  // non-interview jobs. Admin/staff still get access via the staff grant
  // inside evaluate once relevance passes.
  noAdminBypass: true,
  // Result depends on mutable data (plugin configs, interview rows) that has
  // no cache invalidation hook; don't cache stale visibility for 5 minutes.
  skipCache: true,

  describeRequirements: () => [
    { permission: 'staff' },
    { all: [{ permission: 'employer' }, { attribute: "associated with the job's employer" }] },
  ],

  async evaluate(ctx: PolicyContext) {
    // Interviews must be relevant for the job at all (interview-required
    // eligibility plugin on the job type, or existing interview rows) —
    // hides the tab for everyone, staff included, on non-interview jobs.
    let job: { id: string; jobTypeId?: string | null; employerId?: string | null } | undefined;
    if (ctx.entityId) {
      job = await ctx.storage.dispatchJobs?.get?.(ctx.entityId);
    }
    if (!job || !(await jobInterviewsAvailable(ctx.storage, job))) {
      return { granted: false, reason: 'Interviews are not enabled for this job' };
    }

    // noAdminBypass means admins reach evaluate too — re-grant them here
    // (permissions are exact role membership; admin does not imply staff).
    if (await ctx.hasAnyPermission(['staff', 'admin'])) {
      return { granted: true, reason: 'Staff access' };
    }

    if (job.employerId && (await ctx.checkPolicy('employer.mine', job.employerId))) {
      return { granted: true, reason: "Associated with this job's employer" };
    }

    return { granted: false, reason: 'No access to interviews for this job' };
  },
});

registerPolicy(policy);
export default policy;
