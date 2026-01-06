import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'ledger.stripe.employer',
  description: 'Access employer Stripe payments',
  scope: 'entity',
  component: 'ledger.stripe',
  rules: [
    { permission: 'staff' },
    { permission: 'employer.ledger', policy: 'employer.mine' }
  ],
});

registerPolicy(policy);
export default policy;
