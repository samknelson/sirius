import { registerSmsProviders } from './sms/register';
import { registerEmailProviders } from './email/register';
import { registerPostalProviders } from './postal/register';

export function initializeServiceProviders(): void {
  registerSmsProviders();
  registerEmailProviders();
  registerPostalProviders();
}

initializeServiceProviders();
