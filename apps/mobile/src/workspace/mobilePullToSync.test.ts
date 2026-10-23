import { describe, expect, it, vi } from 'vitest'
import { mobilePullToSyncProps } from './mobilePullToSync'

describe('mobile pull-to-sync', () => {
  it.each([true, false])('uses the existing sync callback with AutoGit=%s', async (autoGit) => {
    const syncVault = vi.fn()
    const sync = async () => {
      syncVault(autoGit)
    }
    const props = mobilePullToSyncProps({
      git: true,
      linked: false,
      busy: false,
      phase: null,
      sync,
    })

    expect(props?.refreshing).toBe(false)
    props?.onRefresh()
    expect(syncVault).toHaveBeenCalledExactlyOnceWith(autoGit)
  })

  it('allows linked folders, ignores local-only vaults, and prevents duplicate syncs', () => {
    const sync = vi.fn(async () => {})
    expect(
      mobilePullToSyncProps({
        git: false,
        linked: true,
        busy: false,
        phase: null,
        sync,
      }),
    ).not.toBeNull()
    expect(
      mobilePullToSyncProps({
        git: false,
        linked: false,
        busy: false,
        phase: null,
        sync,
      }),
    ).toBeNull()

    const busyProps = mobilePullToSyncProps({
      git: true,
      linked: false,
      busy: true,
      phase: 'fetch',
      sync,
    })
    expect(busyProps?.refreshing).toBe(true)
    busyProps?.onRefresh()
    expect(sync).not.toHaveBeenCalled()
  })
})
