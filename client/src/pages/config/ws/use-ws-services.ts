import { useQuery } from "@tanstack/react-query";
import {
  pluginConfigsUrl,
  pluginConfigsQueryKey,
  pluginManifestUrl,
  pluginManifestQueryKey,
} from "@/plugins/_core/manifest";

/**
 * One web service: a `plugin_configs` row of kind `web-service`, as returned
 * by the generic config endpoint. Its `id` is the first segment of the public
 * URL; `alias`, when set, is a second, environment-independent address for the
 * same service.
 */
export interface WsServiceConfig {
  id: string;
  pluginKind: string;
  pluginId: string;
  name: string | null;
  enabled: boolean;
  ordering: number;
  alias: string | null;
  data?: Record<string, unknown> | null;
}

/** A declared, callable operation of a web service plugin. */
export interface WsServiceOperation {
  name: string;
  methods: string[];
  description: string;
}

/** A registered web-service plugin and the operations it exposes. */
export interface WsServicePlugin {
  id: string;
  name: string;
  description: string;
  operations: WsServiceOperation[];
}

/** A grant row: this client may call this configuration. */
export interface WsClientGrant {
  id: string;
  clientId: string;
  configId: string;
  createdAt: string;
}

/** Every web service configuration the current admin can see. */
export function useWsServiceConfigs() {
  return useQuery<WsServiceConfig[]>({
    queryKey: pluginConfigsQueryKey("web-service"),
  });
}

/** Every registered web-service plugin, with its declared operations. */
export function useWsServicePlugins() {
  return useQuery<WsServicePlugin[]>({
    queryKey: pluginManifestQueryKey("web-service"),
  });
}

/** The grants held by one client. */
export function useWsClientGrants(clientId: string | undefined) {
  return useQuery<WsClientGrant[]>({
    queryKey: ["/api/admin/ws-clients", clientId, "grants"],
    enabled: !!clientId,
  });
}

export const wsServiceConfigsUrl = () => pluginConfigsUrl("web-service");
export const wsServicePluginsUrl = () => pluginManifestUrl("web-service");

/** Human label for a configuration, falling back to its alias then its id. */
export function wsServiceLabel(config: WsServiceConfig): string {
  return config.name?.trim() || config.alias || config.id;
}

/**
 * The address a caller uses. Prefer the alias: configuration ids are minted
 * per database, so an alias is the only address that is the same in every
 * environment.
 */
export function wsServiceAddress(config: WsServiceConfig): string {
  return config.alias || config.id;
}
