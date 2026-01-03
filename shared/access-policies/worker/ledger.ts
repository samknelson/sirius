import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'worker.ledger',
  description: 'Access to worker ledger - requires staff permission OR (worker.ledger permission AND worker.mine policy)',
  scope: 'entity',
  component: 'ledger',
  rules: [
    { permission: 'staff' },
    { permission: 'worker.ledger', policy: 'worker.mine' }
  ],
});

registerPolicy(policy);
export default policy;
