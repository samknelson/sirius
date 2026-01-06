import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'employer.ledger',
  description: 'Access employer financial records',
  scope: 'entity',
  component: 'ledger',
  rules: [
    { permission: 'staff' },
    { permission: 'employer.ledger', policy: 'employer.mine' }
  ],
});

registerPolicy(policy);
export default policy;
