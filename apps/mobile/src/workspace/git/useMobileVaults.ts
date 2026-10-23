import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { createWorkspaceSyncEditors } from '../workspaceSyncEditors'
import { managedGitConnection } from './managedGitStorage'
import { createMobileVaultCatalogActions, type VaultTask } from './mobileVaultCatalogActions'
import { nativeGitHttp } from './nativeGitHttp'
import { runSavedVaultOperation } from './savedVaultOperation'
import { useGitHubAccount } from './useGitHubAccount'
import { useManagedVaultCatalog, type ActiveVault } from './useManagedVaultCatalog'
import { githubFailure } from './githubFailure'
import { FolderOpenFailure, folderOpenMessage } from '../folderOpenFailure'
import { createGitVault, type GitAuthor } from './gitVault'
import { withSavedWorkspace } from './workspaceWriteQueue'
import { useMobileSettings } from '../../settings/useMobileSettings'
import { useMobileAutoGit } from './useMobileAutoGit'
import { useMobileAnalytics } from '../../analytics/useMobileAnalytics'
import { useMobileVaultEvents } from '../../analytics/useMobileDiscoveryEvents'
import { isWorkspaceLinked, syncLinkedWorkspace } from '../linkedWorkspace'
import { useLinkedFolderSync } from '../useLinkedFolderSync'
import { requireActiveSync } from '../syncCancellation'
import { createGitEditorAccess } from './gitEditorAccess'
import { syncFailureKind } from '../syncFailure'
import { useVaultSyncLedger } from '../useVaultSyncLedger'
import type { VaultSyncState } from '../syncLedgerModel'
import { inspectVaultConflicts, resolveVaultConflicts, type VaultConflictReview } from '../vaultConflictOperations'
import type { SyncConflictChoices } from '../syncConflictModel'
import { useGitCloneProgress } from './useGitCloneProgress'
import { useGitSyncProgress } from './useGitSyncProgress'
import { useVaultNotices } from '../useVaultNotices'
import type { ManagedGitVault } from './managedGitVaults'
import type { ManagedLocalVault } from './managedLocalVaults'
import { usePreparedVaultRefresh } from './usePreparedVaultRefresh'

export type { VaultSyncState } from '../syncLedgerModel'
type VaultError = ReturnType<typeof githubFailure> | ReturnType<typeof folderOpenMessage> | 'mobile.vaults.saveFailed' | 'mobile.vaults.folderUnavailable' | 'mobile.vaults.folderConflict' | null

export function useMobileVaults() {
  const catalog = useManagedVaultCatalog()
  const account = useGitHubAccount()
  const cloneProgress = useGitCloneProgress()
  const syncProgress = useGitSyncProgress()
  const preferences = useMobileSettings()
  const analytics = useMobileAnalytics()
  const [editors] = useState(createWorkspaceSyncEditors)
  const [override, setOverride] = useState<ActiveVault | null>(null)
  const active = override ?? catalog.restored ?? { selection: null, git: null }
  useMobileVaultEvents(active.selection?.vaultRootUri)
  const [revision, setRevision] = useState(0)
  const workspaceRefresh = usePreparedVaultRefresh(next => {
    setOverride(next)
    setRevision(value => value + 1)
  })
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [conflictReview, setConflictReview] = useState<VaultConflictReview | null>(null)
  const [conflictFailure, setConflictFailure] = useState<'stale' | 'local' | null>(null)
  const syncHistory = useVaultSyncLedger(activeVaultId(active))
  const notices = useVaultNotices(activeVaultId(active))
  const { record: { phase, status, lastCommitId }, setStatus, setPhase, setLastCommitId } = syncHistory
  const [error, setError] = useState<VaultError>(null)
  const running = useRef(false)
  const dirtyVersion = useVaultDirtyVersion(editors, syncHistory)
  const restorePending = catalog.pending || !syncHistory.ready
  const linked = !active.git && isWorkspaceLinked(active.selection?.vaultRootUri)
  const open = useCallback(async () => { editors.setBlocked(true); setOpened(true) }, [editors])
  const close = () => {
    if (running.current) return
    account.cancelSignIn()
    setConflictReview(null)
    editors.setBlocked(false)
    setOpened(false)
  }

  const beginOperation = (present: boolean, networkSync: boolean, operation?: 'commit' | 'sync' | 'autoSync') => {
    if (operation && active.git) analytics.capture({ name: 'mobile_git_operation_requested', operation })
    if (operation === 'sync' && linked) analytics.capture({ name: 'mobile_folder_sync_requested', operation })
    if (!networkSync) editors.setBlocked(true)
    setBusy(true)
    if (present) setOpened(true)
    setError(null)
  }
  const handleFolderOpenFailure = (failure: FolderOpenFailure, present: boolean, operation?: 'commit' | 'sync' | 'autoSync') => {
    setError(folderOpenMessage(failure))
    if (operation !== 'sync' && operation !== 'autoSync' && (present || !linked)) return 'failed' as const
    syncHistory.setProblem('provider')
    setStatus('failed')
    if (!present) notices.show('provider')
    return 'failed' as const
  }
  const handleOperationFailure = (failure: unknown, saved: boolean, present: boolean, signal?: AbortSignal, operation?: 'commit' | 'sync' | 'autoSync') => {
    const interruption = operationInterruption(failure, signal)
    if (interruption) { setStatus('pending'); return interruption }
    if (failure instanceof FolderOpenFailure) return handleFolderOpenFailure(failure, present, operation)
    const kind = syncFailureKind(failure)
    syncHistory.setProblem(kind)
    const result = vaultFailure(saved, failure)
    setError(result.error)
    if (!present) notices.show(saved ? kind : 'saveFailed')
    if (!present && kind === 'retry') { setStatus('pending'); return 'retry' }
    setStatus(result.status)
    return 'failed'
  }
  const finishOperation = ({ networkSync, present }: { networkSync: boolean; present: boolean }) => {
    running.current = false
    setBusy(false)
    setPhase(null)
    if (networkSync || !present) editors.setBlocked(false)
  }
  const perform = async (task: VaultTask, present = true, operation?: 'commit' | 'sync' | 'autoSync', signal?: AbortSignal) => {
    if (running.current || restorePending) return
    running.current = true
    const networkSync = Boolean(active.git && (operation === 'sync' || operation === 'autoSync'))
    beginOperation(present, networkSync, operation)
    // A catalog dialog must not erase the active vault's existing sync problem.
    if (!isCatalogOperation(present, operation)) syncHistory.setProblem(null)
    let next = active
    let saved = false
    try {
      if (networkSync) { saved = true; await task(); return }
      await runSavedVaultOperation({
        editors, rootUri: active.selection?.vaultRootUri,
        deferWhileFocused: () => automaticSyncInForeground(signal),
        run: async () => {
          saved = true
          return resolveVaultTask(task, active, (result) => { next = result })
        },
        refresh: selectedNoteId => workspaceRefresh.refresh(next, active, selectedNoteId),
      })
    } catch (failure) {
      const outcome = handleOperationFailure(failure, saved, present, signal, operation)
      return operationRetry(outcome)
    } finally {
      finishOperation({ networkSync, present })
    }
  }

  const syncFolder = async (root: string) => {
    const pendingCheckpoint = syncHistory.pendingCheckpoint()
    const result = await syncLinkedWorkspace(root)
    if (!result.conflict) syncHistory.acknowledgePending(pendingCheckpoint)
    setStatus(result.conflict ? 'diverged' : 'synced')
    syncHistory.setProblem(result.conflict ? 'conflict' : null)
    setError(result.conflict ? 'mobile.vaults.folderConflict' : null)
    if (result.conflict) notices.show('conflict')
    else notices.recovered()
    if (result.changed) return null
    return 'unchanged' as const
  }
  const syncTask = async (checkpoint: boolean, signal?: AbortSignal) => {
    requireActiveSync(signal)
    if (linked && active.selection) return syncFolder(active.selection.vaultRootUri)
    if (!active.git) { setStatus('local'); return null }
    const connection = managedGitConnection(active.git)
    const { syncGitVault } = await import('./gitRemote')
    let checkpointVersion = dirtyVersion.current
    const localAccess = createGitEditorAccess({
      editors, rootUri: active.selection?.vaultRootUri,
      deferWhileFocused: () => automaticSyncInForeground(signal),
      refresh: selectedNoteId => workspaceRefresh.refresh(active, active, selectedNoteId),
    })
    const result = await syncProgress.run(onProgress => syncGitVault({
      ...connection, http: nativeGitHttp,
      checkpoint, signal, onProgress,
      onCheckpoint: oid => { setLastCommitId(oid.slice(0, 8)); setStatus('committed') },
      withLocalAccess: async run => {
        const value = await localAccess(async () => {
          const pendingCheckpoint = syncHistory.pendingCheckpoint()
          const result = await run()
          syncHistory.acknowledgePending(pendingCheckpoint)
          return result
        })
        checkpointVersion = dirtyVersion.current
        return value
      },
      getToken: async () => (await account.currentSession())?.accessToken,
      onPhase: phase => { setPhase(phase); syncProgress.clear() },
    }, mobileGitAuthor(account.session)))
    syncHistory.complete(result.kind, checkpointVersion !== dirtyVersion.current)
    if (result.kind === 'diverged') notices.show('conflict')
    else notices.recovered()
    if (result.workspaceChanged) return null
    return 'unchanged' as const
  }
  const sync = async () => { await perform(() => syncTask(preferences.settings.autoGit), false, 'sync') }
  const reviewConflicts = () => perform(async () => {
    setConflictFailure(null)
    setConflictReview(await inspectVaultConflicts(active, mobileGitAuthor(account.session), preferences.settings.autoGit))
    return 'unchanged'
  })
  const resolveConflicts = async (choices: SyncConflictChoices) => {
    if (!conflictReview) return
    let resolved = false
    await perform(async () => {
      try {
        const pendingCheckpoint = syncHistory.pendingCheckpoint()
        const oid = await resolveVaultConflicts(active, conflictReview, choices, mobileGitAuthor(account.session))
        syncHistory.acknowledgePending(pendingCheckpoint)
        recordResolution(oid)
        resolved = true
        return null
      } catch (failure) {
        setConflictFailure(conflictFailureKind(failure))
        throw failure
      }
    })
    if (resolved && active.git) await perform(() => syncTask(false), true, 'sync')
  }
  const commit = async (message: string, push = false) => {
    let committed = false
    await perform(async () => {
    if (!active.git) return 'cancelled'
    setPhase('checkpoint')
    const connection = managedGitConnection(active.git)
    const pendingCheckpoint = syncHistory.pendingCheckpoint()
    const result = await withSavedWorkspace(connection.operationKey ?? connection.dir, () => createGitVault(connection).checkpoint(mobileGitAuthor(account.session), message))
    syncHistory.acknowledgePending(pendingCheckpoint)
    if (result.changedFiles > 0) analytics.capture({ name: 'commit_made' })
    setLastCommitId(result.oid.slice(0, 8))
    setStatus('committed')
    committed = true
    return result.workspaceChanged ? null : 'unchanged'
  }, true, 'commit')
    if (committed && push) await perform(() => syncTask(false), true, 'sync')
  }

  const recordResolution = (oid: string | null) => {
    if (oid) setLastCommitId(oid.slice(0, 8))
    setStatus(oid ? 'committed' : 'synced')
    notices.recovered()
    analytics.capture({ name: active.git ? 'mobile_git_operation_requested' : 'mobile_folder_sync_requested', operation: 'resolveConflicts' })
    setConflictReview(null)
  }
  const cancelConflictReview = () => {
    if (busy) return
    setConflictReview(null)
    setConflictFailure(null)
    setStatus('diverged')
  }

  useVaultBackgroundSync({
    active, linked, editors, busy, opened, restorePending: restorePending || workspaceRefresh.failed, status,
    syncGit: signal => perform(() => syncTask(true, signal), false, 'autoSync', signal),
    syncFolder: signal => perform(() => syncTask(false, signal), false, undefined, signal),
  })

  const catalogActions = (present = true) => createMobileVaultCatalogActions({
    active, catalog, perform: task => perform(task, present), capture: analytics.capture,
    currentSession: account.currentSession, runClone: cloneProgress.run,
    startClone: () => setPhase('clone'),
  })
  return {
    openFolder: () => catalogActions().openFolder(),
    select: (vault: ManagedGitVault, present = true) => catalogActions(present).select(vault),
    selectLocal: (vault: ManagedLocalVault, present = true) => catalogActions(present).selectLocal(vault),
    forget: (id: string) => catalogActions().forget(id),
    clone: (url: string) => catalogActions().clone(url),
    account, active, busy, catalog, close, cloneProgress, syncProgress, editors, error, open, opened, linked, syncHistory, notices,
    phase, restorePending, revision, status, sync, commit, lastCommitId,
    refreshFailed: workspaceRefresh.failed, retryWorkspace: () => perform(async () => active, false),
    conflictReview, conflictFailure, reviewConflicts, resolveConflicts, cancelConflictReview,
  }
}

type BackgroundSyncOptions = {
  active: ActiveVault; linked: boolean; busy: boolean; opened: boolean
  restorePending: boolean; status: VaultSyncState
  editors: ReturnType<typeof createWorkspaceSyncEditors>
  syncGit: Parameters<typeof useMobileAutoGit>[0]['sync']
  syncFolder: Parameters<typeof useLinkedFolderSync>[0]['sync']
}

function useVaultDirtyVersion(editors: ReturnType<typeof createWorkspaceSyncEditors>, history: ReturnType<typeof useVaultSyncLedger>) {
  const version = useRef(0)
  const { markDirty } = history
  useEffect(() => editors.subscribeDirty(paths => {
    version.current += 1
    // Editing does not resolve a conflict or authorize another automatic sync.
    markDirty(paths)
  }), [editors, markDirty])
  return version
}

function useVaultBackgroundSync(options: BackgroundSyncOptions) {
  const preferences = useMobileSettings()
  const blocked = backgroundSyncBlocked(options, preferences.opened)
  const rootUri = options.active.selection?.vaultRootUri
  useMobileAutoGit({
    blocked, editors: options.editors, rootUri, sync: options.syncGit,
    enabled: preferences.ready && preferences.settings.autoGit && Boolean(options.active.git),
  })
  useLinkedFolderSync({
    root: options.linked ? rootUri : undefined,
    blocked: blocked || options.status === 'failed',
    editors: options.editors, sync: options.syncFolder,
  })
}

function backgroundSyncBlocked(options: BackgroundSyncOptions, settingsOpened: boolean) {
  return options.busy || options.opened || settingsOpened || options.restorePending || options.status === 'diverged'
}

function automaticSyncInForeground(signal?: AbortSignal) {
  return Boolean(signal) && AppState.currentState === 'active'
}

function operationInterruption(failure: unknown, signal?: AbortSignal) {
  if (failure instanceof Error && failure.message === 'editorSyncDeferred') return 'deferred'
  if (signal?.aborted) return 'cancelled'
}

function operationRetry(outcome: 'retry' | 'deferred' | 'failed' | 'cancelled') {
  if (outcome === 'retry') return { retry: true }
  if (outcome === 'deferred') return { deferred: true }
}

function isCatalogOperation(present: boolean, operation?: 'commit' | 'sync' | 'autoSync') {
  return present && !operation
}

function activeVaultId(active: ActiveVault) {
  return active.git?.id ?? active.selection?.vaultAlias ?? undefined
}

function conflictFailureKind(failure: unknown) {
  return failure instanceof Error && failure.message === 'syncConflictStale' ? 'stale' : 'local'
}

async function resolveVaultTask(task: VaultTask, active: ActiveVault, select: (next: ActiveVault) => void) {
  const result = await task()
  if (result === 'cancelled' || result === 'unchanged') return result
  select(result ?? active)
}

function vaultFailure(saved: boolean, failure: unknown): { error: VaultError; status: VaultSyncState } {
  if (!saved) return { error: 'mobile.vaults.saveFailed', status: 'saveFailed' }
  if (failure instanceof Error && failure.message === 'linkedFolderUnavailable') return { error: 'mobile.vaults.folderUnavailable', status: 'failed' }
  return { error: githubFailure(failure), status: 'failed' }
}

function mobileGitAuthor(session: { login: string; userId: number } | null): GitAuthor {
  return session
    ? { name: session.login, email: `${session.userId}+${session.login}@users.noreply.github.com` }
    : { name: 'Tolaria mobile', email: 'mobile@tolaria.app' }
}
