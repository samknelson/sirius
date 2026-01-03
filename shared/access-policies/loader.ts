/**
 * Policy Loader
 * 
 * Imports all policy files to register them with the policy registry.
 * This file should be imported once during server startup.
 */

import './core/authenticated';
import './core/admin';
import './core/staff';
import './core/masquerade';
import './core/trust-provider-user-manage';

import './ledger/staff';
import './ledger/stripe-admin';
import './ledger/stripe-employer';
import './ledger/ea/view';
import './ledger/ea/edit';

import './employer/manage';
import './employer/view';
import './employer/mine';
import './employer/ledger';

import './worker/view';
import './worker/edit';
import './worker/mine';
import './worker/ledger';

import './provider/ledger';

import './cardcheck/view';
import './cardcheck/edit';

import './esig/view';
import './esig/edit';

import './file/upload';
import './file/read';
import './file/update';
import './file/delete';

import './contact/view';
import './contact/edit';

import './dispatch/dnc/view';
import './dispatch/dnc/edit';
import './dispatch/employer/dispatch';
import './dispatch/employer/dispatch-manage';

export { getAllPolicies, getPolicy, hasPolicy } from './index';
