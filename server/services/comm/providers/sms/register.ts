import { serviceRegistry } from '../../../service-registry';
import { TwilioSmsProvider } from './twilio';
import { LocalSmsProvider } from './local';

export function registerSmsProviders(): void {
  serviceRegistry.registerProvider('sms', 'twilio', {
    create: () => new TwilioSmsProvider(),
  });

  serviceRegistry.registerProvider('sms', 'local', {
    create: () => new LocalSmsProvider(),
  });
}
