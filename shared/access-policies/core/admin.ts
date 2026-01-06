import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'admin',
  description: 'Administrator access',
  scope: 'route',
  rules: [{ permission: 'admin' }],
});

registerPolicy(policy);
export default policy;
