/** Types for AdGuard Atlas World Map */

export type QueryClass = 'allowed' | 'blocked' | 'local' | 'noanswer';

export const QUERY_CLASSES: readonly QueryClass[] = ['allowed', 'blocked', 'local', 'noanswer'];

export const APP_VERSION = '1.0.0';

/** Where an answer points, as far as the GeoIP database knows. */
export interface Destination {
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  /** ISO 3166-1 alpha-2 */
  cc?: string;
}

/** One DNS query, classified and located. */
export interface AtlasEvent {
  id: string;
  /** Unix time in milliseconds */
  t: number;
  /** Display name of the AdGuard Home instance */
  instance: string;
  /** Device name, or its IP address when AdGuard Home has no name for it */
  client: string;
  domain: string;
  qtype: string;
  cls: QueryClass;
  dest?: Destination;
}

export interface InstanceStatus {
  name: string;
  state: 'connecting' | 'ok' | 'error';
  message?: string;
  lastOk?: number;
}

export interface ServerStatus {
  instances: InstanceStatus[];
  geoip: boolean;
}

export interface SnapshotMessage {
  now: number;
  events: AtlasEvent[];
  status: ServerStatus;
}

export interface ClientConfig {
  mode: 'live' | 'demo';
  home: { lat: number; lon: number; label: string };
  windowMinutes: number;
  privacyForced: boolean;
  version: string;
}

export const DEMO_HOME = { lat: 28.6139, lon: 77.2090 };

export const DEFAULT_WINDOW_MINUTES = 15;

export const STATIC_DEMO_CONFIG: ClientConfig = {
  mode: 'demo',
  home: { ...DEMO_HOME, label: 'Home' },
  windowMinutes: DEFAULT_WINDOW_MINUTES,
  privacyForced: false,
  version: APP_VERSION,
};
