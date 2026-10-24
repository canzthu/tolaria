import { afterEach, describe, expect, it, vi } from 'vitest'

const remoteGlobals = globalThis as { TOLARIA_REMOTE_URL?: string; TOLARIA_REMOTE_TOKEN?: string }

async function loadMockEntries() {
  vi.resetModules()
  return (await import('./mock-entries')).MOCK_ENTRIES
}

describe('mock entries', () => {
  afterEach(() => {
    delete remoteGlobals.TOLARIA_REMOTE_URL
    delete remoteGlobals.TOLARIA_REMOTE_TOKEN
  })

  it('include a large generated vault for demo data', async () => {
    expect((await loadMockEntries()).length).toBeGreaterThan(9000)
  })

  it('skip the generated vault on a Tolaria remote, which never lists demo data (TOL-206)', async () => {
    remoteGlobals.TOLARIA_REMOTE_URL = 'https://tolaria.example'
    remoteGlobals.TOLARIA_REMOTE_TOKEN = 'token-not-a-secret'

    expect((await loadMockEntries()).length).toBeLessThan(100)
  })
})
