import type { HermesTransport } from '../app-types.js';

export const HERMES_DEFAULT_HOST = '127.0.0.1';
export const HERMES_DEFAULT_GATEWAY_PORT = 8642;
export const HERMES_DEFAULT_GATEWAY_PATH = '/v1';
export const HERMES_DEFAULT_DASHBOARD_PORT = 9119;

export const DEFAULT_HERMES_TRANSPORT: HermesTransport = 'relay_daemon';
export const DEFAULT_HERMES_GATEWAY_URL = `http://${HERMES_DEFAULT_HOST}:8787`;
