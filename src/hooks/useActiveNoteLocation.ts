import { useCallback, useState } from 'react'
import type { VaultEntry } from '../types'
import { findRouteEntry, parseWebRoute, routeMatchesVault, routeVaultSlug, type WebRoute } from '../utils/webRoute'
import { useLastActiveNote } from './useLastActiveNote'
import { useWebRouting, type WebRoutingOptions } from './useWebRouting'

export interface ActiveNoteLocationOptions extends Omit<WebRoutingOptions, 'enabled' | 'initialRoute' | 'ready'> {
  /** Restores the last open note: the main window only. */
  enabled: boolean
  isVaultLoading: boolean
}

/** Only the web build routes; desktop, including its browser dev build, keeps its URL. */
function isWebBuild(): boolean {
  return import.meta.env.VITE_TOLARIA_WEB_BUILD === 'true'
}

type RouteEntryResolver = (entries: VaultEntry[]) => VaultEntry | undefined

function useInitialWebRoute(enabled: boolean): WebRoute | null {
  const [route] = useState(() => (enabled ? parseWebRoute(window.location.search) : null))
  return route
}

function useRouteEntryResolver(
  route: WebRoute | null,
  { vaultPath, vaults }: Pick<ActiveNoteLocationOptions, 'vaultPath' | 'vaults'>,
): RouteEntryResolver | undefined {
  const resolve = useCallback<RouteEntryResolver>((entries) => {
    if (!route?.note || !routeMatchesVault(route, routeVaultSlug({ vaultPath, vaults }))) return undefined
    return findRouteEntry(entries, { notePath: route.note, vaultPath })
  }, [route, vaultPath, vaults])
  return route?.note ? resolve : undefined
}

/**
 * Which note is open when the app starts, and on the web where the URL says it is: the note a
 * shared or reloaded URL names wins over the last open note, then the URL follows (TOL-175).
 */
export function useActiveNoteLocation({ enabled, isVaultLoading, ...routing }: ActiveNoteLocationOptions): void {
  const webRouting = enabled && isWebBuild()
  const initialRoute = useInitialWebRoute(webRouting)
  const preferredEntry = useRouteEntryResolver(initialRoute, routing)
  const ready = useLastActiveNote({
    activeTabPath: routing.activeNotePath,
    enabled,
    entries: routing.entries,
    isVaultLoading,
    openNote: routing.openNote,
    preferredEntry,
  })
  useWebRouting({ ...routing, enabled: webRouting, initialRoute, ready })
}
