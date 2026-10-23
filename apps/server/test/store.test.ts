import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDiskStore, R2BlobStore } from '../src/store.ts'
import { text } from './helpers.ts'

/**
 * Minimal in-process S3-compatible fake for testing R2BlobStore.
 * Implements GET/PUT/DELETE/LIST without real credentials.
 */
class FakeS3Server {
  private server: Server
  private storage = new Map<string, Uint8Array>()
  private port = 0

  constructor() {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        res.statusCode = 500
        res.end(String(error))
      })
    })
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address()
        if (address && typeof address === 'object') {
          this.port = address.port
          resolve(`http://127.0.0.1:${this.port}`)
        }
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const key = url.pathname.slice(1).replace(/^[^/]+\//, '')

    if (req.method === 'GET' && url.searchParams.has('list-type')) {
      const prefix = url.searchParams.get('prefix') ?? ''
      const keys = Array.from(this.storage.keys()).filter((k) => k.startsWith(prefix))
      const xml = `<?xml version="1.0"?><ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`
      res.writeHead(200, { 'Content-Type': 'application/xml' })
      res.end(xml)
      return
    }

    if (req.method === 'GET') {
      const value = this.storage.get(key)
      if (!value) {
        res.statusCode = 404
        res.end()
        return
      }
      res.writeHead(200)
      res.end(value)
      return
    }

    if (req.method === 'PUT') {
      const chunks: Uint8Array[] = []
      for await (const chunk of req) {
        chunks.push(chunk as Uint8Array)
      }
      const buffer = Buffer.concat(chunks)
      this.storage.set(key, new Uint8Array(buffer))
      res.writeHead(200)
      res.end()
      return
    }

    if (req.method === 'DELETE') {
      this.storage.delete(key)
      res.writeHead(204)
      res.end()
      return
    }

    res.statusCode = 405
    res.end()
  }
}

describe('LocalDiskStore', () => {
  let root: string
  let store: LocalDiskStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tolaria-store-test-'))
    store = new LocalDiskStore(root)
  })

  afterEach(() => rm(root, { recursive: true, force: true }))

  it('returns null for a key that was never written', async () => {
    expect(await store.get('docs/missing')).toBeNull()
  })

  it('stores, overwrites and deletes values', async () => {
    await store.put('docs/a.bin', text('one'))
    await store.put('docs/a.bin', text('two'))
    expect(Buffer.from((await store.get('docs/a.bin')) as Uint8Array).toString()).toBe('two')

    await store.delete('docs/a.bin')
    await store.delete('docs/a.bin')
    expect(await store.get('docs/a.bin')).toBeNull()
  })

  it('lists the keys under a prefix and leaves no temporary files behind', async () => {
    await store.put('docs/a', text('a'))
    await store.put('docs/b', text('b'))
    expect((await store.list('docs')).sort()).toEqual(['docs/a', 'docs/b'])
    expect(await store.list('nothing')).toEqual([])
    expect((await readdir(join(root, 'docs'))).sort()).toEqual(['a', 'b'])
  })

  it.each(['../escape', '/absolute', 'a/../b', 'a//b', '.hidden', 'a/.b', '', 'a b'])(
    'rejects the unsafe key %j',
    async (key) => {
      await expect(store.put(key, text('x'))).rejects.toThrowError(/invalid store key/)
      await expect(store.get(key)).rejects.toThrowError(/invalid store key/)
    },
  )

  it('reports failures other than a missing file', async () => {
    await store.put('docs/a', text('a'))
    await expect(store.get('docs')).rejects.toThrowError(/EISDIR/)
    await expect(store.list('docs/a')).rejects.toThrowError(/ENOTDIR/)
  })
})

describe('R2BlobStore', () => {
  let server: FakeS3Server
  let store: R2BlobStore
  let endpoint: string

  beforeEach(async () => {
    server = new FakeS3Server()
    endpoint = await server.start()
    store = new R2BlobStore({
      bucket: 'test-bucket',
      endpoint,
      region: 'auto',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    })
  })

  afterEach(async () => {
    await server.stop()
  })

  it('returns null for a key that was never written', async () => {
    expect(await store.get('docs/missing')).toBeNull()
  })

  it('stores, overwrites and deletes values', async () => {
    await store.put('docs/a.bin', text('one'))
    await store.put('docs/a.bin', text('two'))
    expect(Buffer.from((await store.get('docs/a.bin')) as Uint8Array).toString()).toBe('two')

    await store.delete('docs/a.bin')
    await store.delete('docs/a.bin')
    expect(await store.get('docs/a.bin')).toBeNull()
  })

  it('lists the keys under a prefix', async () => {
    await store.put('docs/a', text('a'))
    await store.put('docs/b', text('b'))
    expect((await store.list('docs')).sort()).toEqual(['docs/a', 'docs/b'])
    expect(await store.list('nothing')).toEqual([])
  })

  it('survives restart with fresh disk - data persists in R2', async () => {
    await store.put('docs/index.bin', text('persistent-doc-index'))
    await store.put('snapshots/note-1.bin', text('persistent-snapshot'))
    
    const store2 = new R2BlobStore({
      bucket: 'test-bucket',
      endpoint,
      region: 'auto',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    })
    
    const indexData = await store2.get('docs/index.bin')
    const snapshotData = await store2.get('snapshots/note-1.bin')
    
    expect(Buffer.from(indexData as Uint8Array).toString()).toBe('persistent-doc-index')
    expect(Buffer.from(snapshotData as Uint8Array).toString()).toBe('persistent-snapshot')
  })

  it('throws readable errors on failures', async () => {
    await server.stop()
    await expect(store.get('docs/a')).rejects.toThrow()
  })

  it('never leaks credentials in error messages', async () => {
    await server.stop()
    try {
      await store.get('docs/test')
      throw new Error('should have thrown')
    } catch (error) {
      const message = String(error)
      expect(message).not.toContain('test-key')
      expect(message).not.toContain('test-secret')
    }
  })
})
