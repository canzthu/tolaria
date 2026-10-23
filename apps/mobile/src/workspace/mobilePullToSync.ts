import type { SyncPhase } from './syncLedgerModel'

type PullToSyncControls = {
  busy: boolean
  git: boolean
  linked?: boolean
  phase?: SyncPhase
  sync: () => Promise<void>
}

export function mobilePullToSyncProps(controls: PullToSyncControls | null) {
  if (!controls) return null
  if (!supportsPullToSync(controls)) return null

  return {
    refreshing: isRefreshing(controls),
    onRefresh: refreshWhenIdle(controls),
  }
}

function supportsPullToSync(controls: PullToSyncControls) {
  if (controls.git) return true
  return Boolean(controls.linked)
}

function isRefreshing(controls: PullToSyncControls) {
  if (!controls.busy) return false
  return controls.phase !== 'clone'
}

function refreshWhenIdle(controls: PullToSyncControls) {
  return () => {
    if (controls.busy) return
    void controls.sync()
  }
}
