import { anyPermissionPolicy, registerPolicy } from '../index';

const policy = anyPermissionPolicy(
  'worker.list',
  ['staff', 'workers.view', 'provider', 'trust.provider'],
  'View the worker list'
);

registerPolicy(policy);
export default policy;
