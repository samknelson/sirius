import { serviceRegistry } from '../../../service-registry';
import { SendGridEmailProvider } from './sendgrid';
import { LocalEmailProvider } from './local';

export function registerEmailProviders(): void {
  serviceRegistry.registerProvider('email', 'sendgrid', {
    create: () => new SendGridEmailProvider(),
  });

  serviceRegistry.registerProvider('email', 'local', {
    create: () => new LocalEmailProvider(),
  });
}
