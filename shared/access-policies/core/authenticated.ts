import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'authenticated',
  description: 'Authenticated user access',
  scope: 'route',
  rules: [{ authenticated: true }],
});

registerPolicy(policy);
export default policy;
