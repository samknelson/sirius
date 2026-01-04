import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'staff',
  description: 'Staff-level access',
  scope: 'route',
  rules: [{ permission: 'staff' }],
});

registerPolicy(policy);
export default policy;
