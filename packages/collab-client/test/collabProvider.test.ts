import { afterEach, describe, expect, it, vi } from 'vitest'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createHarness, type Harness, NOTE, settle } from '../../../apps/server/test/collabHelpers.ts'
import { COLLAB_MESSAGE } from '../../protocol/src/index.ts'
import { type CollabStatus, CollabProvider, type SocketLike } from '../src/collabProvider.ts'

let harness: Harness | undefined
let provider: CollabProvider | undefined

afterEach(async () => {
  provider?.destroy()
  await harness?.cleanup()
  harness = undefined
})

/** A socket that never opens, to look at the provider before it is connected. */
function deadSocket(): SocketLike {
  return { binaryType: '', readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send: () => {}, close: () => {} }
}

/** A socket that is open from the start, keeping what the provider sends. */
function openSocket(): SocketLike & { sent: Uint8Array[] } {
  const sent: Uint8Array[] = []
  return { ...deadSocket(), readyState: 1, sent, send: (data) => sent.push(data) }
}

function awarenessSent(socket: { sent: Uint8Array[] }): number {
  return socket.sent.filter((data) => data[0] === COLLAB_MESSAGE.awareness).length
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('CollabProvider', () => {
  it('reports connecting, then syncing, then synced', async () => {
    harness = await createHarness()
    const client = await harness.client()
    const seen: CollabStatus[] = []

    client.provider.onStatus((status) => seen.push(status))
    client.sockets[0].close()
    await client.provider.whenSynced()

    expect(seen).toEqual(['synced', 'offline', 'syncing', 'synced'])
  })

  it('keeps edits made while offline and sends them when the connection is back', async () => {
    harness = await createHarness()
    const ada = await harness.client()
    const luca = await harness.client()

    ada.sockets[0].close()
    ada.type('Alpha', ' written offline')
    expect(luca.markdown()).not.toContain('written offline')
    await ada.provider.whenSynced()
    await settle()

    expect(luca.markdown()).toContain('# Alpha written offline')
  })

  it('stops showing the others while offline', async () => {
    harness = await createHarness()
    const ada = await harness.client()
    const luca = await harness.client()
    luca.provider.awareness.setLocalStateField('user', { name: 'Luca' })
    await settle()

    const before = ada.provider.awareness.getStates().size
    ada.sockets[0].close()

    expect([before, ada.provider.awareness.getStates().has(luca.doc.clientID)]).toEqual([2, false])
  })

  it('retries with a growing delay while the server cannot be reached', async () => {
    const attempts: number[] = []
    const started = Date.now()
    provider = new CollabProvider({
      doc: new Y.Doc(),
      retryMs: 10,
      maxRetryMs: 25,
      openSocket: async () => {
        attempts.push(Date.now() - started)
        throw new Error('unreachable')
      },
    })

    await wait(120)

    expect(provider.status).toBe('offline')
    expect(attempts.length).toBeGreaterThanOrEqual(4)
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(15)
  })

  it('opens with the socket handlers when the socket connects later', async () => {
    const socket = deadSocket()
    const sent: Uint8Array[] = []
    socket.send = (data) => sent.push(data)
    provider = new CollabProvider({ doc: new Y.Doc(), openSocket: async () => socket })
    await settle(1)

    socket.readyState = 1
    socket.onopen?.()
    socket.onopen?.()

    expect(provider.status).toBe('syncing')
    // The document request and the client's own presence, once each.
    expect(sent).toHaveLength(2)
  })

  it('closes a failing socket so that it is retried', async () => {
    const socket = deadSocket()
    let closed = 0
    socket.close = () => closed++
    provider = new CollabProvider({ doc: new Y.Doc(), openSocket: async () => socket })
    await settle(1)

    socket.onerror?.()

    expect(closed).toBe(1)
  })

  it('does nothing after it was destroyed, even when a socket arrives late', async () => {
    const socket = deadSocket()
    let closed = 0
    socket.close = () => closed++
    const doc = new Y.Doc()
    provider = new CollabProvider({ doc, openSocket: async () => socket })

    provider.destroy()
    provider.destroy()
    await settle(1)
    doc.getText('t').insert(0, 'ignored')

    expect([provider.status, closed]).toEqual(['closed', 1])
  })

  it('ignores messages and closes of a socket it has replaced', async () => {
    harness = await createHarness()
    const client = await harness.client(NOTE)
    const [old] = client.sockets
    const { onmessage, onclose } = old

    old.close()
    await client.provider.whenSynced()
    onmessage?.({ data: new Uint8Array([]) })
    onclose?.()

    expect(client.provider.status).toBe('synced')
  })

  it('sends caret moves at most once per throttle interval', async () => {
    const socket = openSocket()
    provider = new CollabProvider({ doc: new Y.Doc(), awarenessThrottleMs: 40, openSocket: async () => socket })
    await settle(1)
    const before = awarenessSent(socket)

    for (let position = 0; position < 5; position++) provider.awareness.setLocalStateField('cursor', position)
    const right = awarenessSent(socket) - before
    await wait(60)

    expect([right, awarenessSent(socket) - before]).toEqual([1, 2])
  })

  it('sends its withdrawal when leaving, even inside a throttle interval', async () => {
    const socket = openSocket()
    provider = new CollabProvider({ doc: new Y.Doc(), awarenessThrottleMs: 10_000, openSocket: async () => socket })
    await settle(1)
    provider.awareness.setLocalStateField('cursor', 1)
    const before = awarenessSent(socket)

    provider.destroy()

    expect(awarenessSent(socket) - before).toBe(1)
  })

  it('drops another client that went silent without telling the server', async () => {
    vi.useFakeTimers()
    try {
      const socket = openSocket()
      provider = new CollabProvider({ doc: new Y.Doc(), presenceTimeoutMs: 3_000, openSocket: async () => socket })
      await vi.advanceTimersByTimeAsync(1)
      const peer = new Y.Doc()
      const peerAwareness = new Awareness(peer)
      peerAwareness.setLocalStateField('user', { name: 'Gone' })
      applyAwarenessUpdate(provider.awareness, encodeAwarenessUpdate(peerAwareness, [peer.clientID]), 'remote')
      const sentBefore = awarenessSent(socket)

      await vi.advanceTimersByTimeAsync(4_100)

      expect(provider.awareness.getStates().has(peer.clientID)).toBe(false)
      // Renewals of its own state only: the drop stays local.
      expect(awarenessSent(socket) - sentBefore).toBe(4)
      peerAwareness.destroy()
    } finally {
      provider?.destroy()
      provider = undefined
      vi.useRealTimers()
    }
  })

  it('ignores a frame that is not binary', async () => {
    const socket = openSocket()
    provider = new CollabProvider({ doc: new Y.Doc(), openSocket: async () => socket })
    await settle(1)
    const before = socket.sent.length

    socket.onmessage?.({ data: 'not ours' })
    socket.onmessage?.({ data: { length: 3 } })

    expect([provider.status, socket.sent.length - before]).toEqual(['syncing', 0])
  })

  it('closes the connection on a frame that does not decode, to start over', async () => {
    const socket = openSocket()
    let closed = 0
    socket.close = () => closed++
    provider = new CollabProvider({ doc: new Y.Doc(), openSocket: async () => socket })
    await settle(1)

    socket.onmessage?.({ data: new Uint8Array([COLLAB_MESSAGE.sync, 1, 200]).buffer })

    expect(closed).toBe(1)
  })
})
