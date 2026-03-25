export type { ConnectorDefinition, ConnectorAction, ConnectorActionResult, ConnectorConfig, ConnectorStatus, ConnectorExecutionContext, BridgeApi } from './connector-types';
export { registerConnector, getConnector, listConnectors, hydrateConnectors, persistConnectorConfig, buildConnectorPromptFragment } from './registry';
export { createFilesystemConnector } from './filesystem';
export { createShellConnector } from './shell';
export { createWebFetchConnector, loadAllowedDomains, saveAllowedDomains } from './web-fetch';
