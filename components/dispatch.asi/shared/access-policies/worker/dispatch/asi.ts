import { definePolicy, registerPolicy } from '../../../../../../shared/access-policies/index';

const policy = definePolicy({
  id: 'worker.dispatch.asi',
  description: 'Access worker auto sign-in settings',
  scope: 'entity',
  component: 'dispatch.asi',
  rules: [
    { permission: 'staff' },
    { permission: 'worker.dispatch.asi', policy: 'worker.mine' }
  ],
});

registerPolicy(policy);
export default policy;
