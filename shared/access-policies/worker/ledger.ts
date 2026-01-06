import { definePolicy, registerPolicy } from '../index';

const policy = definePolicy({
  id: 'worker.ledger',
  description: 'Access worker financial records',
  scope: 'entity',
  component: 'ledger',
  rules: [
    { permission: 'staff' },
    { permission: 'worker.ledger', policy: 'worker.mine' }
  ],
});

registerPolicy(policy);
export default policy;
