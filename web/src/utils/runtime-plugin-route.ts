import { stringifyQuery, type LocationQuery } from 'vue-router';

const pluginNamePattern = /^[a-z][a-z0-9-]{0,63}$/;
const genericPluginRoute = /^\/runtime-plugins\/([a-z][a-z0-9-]{0,63})(?:\/(.*))?$/;

/** Generic entries start at the plugin root; existing business menus retain their inner SPA path. */
export function runtimePluginAdminTarget(path: string, configuredPlugin?: unknown, query?: LocationQuery): string | null {
  const generic = path.match(genericPluginRoute);
  const plugin = typeof configuredPlugin === 'string' && configuredPlugin ? configuredPlugin : generic?.[1];
  if (!plugin || !pluginNamePattern.test(plugin) || (generic && generic[1] !== plugin)) return null;
  const page = generic ? generic[2] || '' : path.replace(/^\//, '');
  const search = query ? stringifyQuery(query) : '';
  return `/plugins/${plugin}/admin/${page}${search ? `?${search}` : ''}`;
}


/** Hide host chrome only inside an actual plugin iframe, never from a caller-supplied query. */
export function isEmbeddedRuntimePlugin(pathname: string, embedded: boolean): boolean {
  return embedded && /^\/plugins\/[a-z][a-z0-9-]{0,63}\/admin(?:\/|$)/.test(pathname);
}

