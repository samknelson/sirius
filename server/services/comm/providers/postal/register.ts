import { serviceRegistry } from '../../../service-registry';
import { LobPostalProvider } from './lob';
import { LocalPostalProvider } from './local';

export function registerPostalProviders(): void {
  serviceRegistry.registerProvider('postal', 'lob', {
    create: () => new LobPostalProvider(),
  });

  serviceRegistry.registerProvider('postal', 'local', {
    create: () => new LocalPostalProvider(),
  });
}
