import { createLinkAdapter } from './link.js';
import { createOnlineAfsprakenAdapter } from './onlineafspraken.js';

// Add other booking systems here: an adapter is { name, reply(): Promise<string> }.
const FACTORIES = {
  link: createLinkAdapter,
  onlineafspraken: createOnlineAfsprakenAdapter,
};

export function getAppointmentAdapter(config) {
  if (!config?.bookingUrl) return null;
  const factory = FACTORIES[config.provider || 'link'];
  if (!factory) throw new Error(`Unknown appointments provider: ${config.provider}`);
  return factory(config);
}
