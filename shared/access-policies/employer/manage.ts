import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'employer.manage',
  description: 'Requires staff permission, OR both employer.manage permission and employer.mine policy',
  scope: 'route',
  rules: [
    { permission: 'staff' },
    { permission: 'employer.manage', policyId: 'employer.mine' }
  ],
});

registerPolicy(policy);
export default policy;
