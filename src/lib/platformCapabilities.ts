/**
 * Platform capabilities: which features are available in the current runtime.
 * Web builds hide desktop-only features (git, MCP, updater, multi-window, CLI agents, OpenCode).
 * Desktop shows everything.
 */

import type { VaultBackendKind } from './vaultBackend/types'

export interface PlatformCapabilities {
  /** Git integration (commit, push, pull, branch management) */
  git: boolean
  /** MCP (Model Context Protocol) server integration */
  mcp: boolean
  /** Automatic update checks and downloads */
  updater: boolean
  /** Multi-window support and "New Window" commands */
  multiWindow: boolean
  /** OpenCode integration (open notes in external editors) */
  openCode: boolean
  /** CLI agents (AI agents that run in the terminal) */
  cliAgents: boolean
}

/**
 * Derive platform capabilities from the vault backend kind.
 * - `tauri` (desktop): all features available
 * - `mock` (desktop unit tests): all features available
 * - `remote` (web): desktop-only features hidden
 */
export function resolvePlatformCapabilities(backendKind: VaultBackendKind): PlatformCapabilities {
  const isDesktop = backendKind === 'tauri' || backendKind === 'mock'

  return {
    git: isDesktop,
    mcp: isDesktop,
    updater: isDesktop,
    multiWindow: isDesktop,
    openCode: isDesktop,
    cliAgents: isDesktop,
  }
}
