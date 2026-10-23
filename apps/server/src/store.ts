import { createHash, createHmac } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Key/value storage for server-side state that is not part of the vault's git history
 * (the doc index, later Y.Doc snapshots). Keys are `/`-separated, so the same interface maps
 * onto an S3-compatible bucket; the spike only ships the local-disk implementation.
 */
export interface BlobStore {
  get(key: string): Promise<Uint8Array | null>
  put(key: string, bytes: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

const SAFE_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class LocalDiskStore implements BlobStore {
  private readonly root: string
  private writes = 0

  constructor(root: string) {
    this.root = root
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.file(key))
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  /** Atomic: readers see the old or the new value, never a torn one. */
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.file(key)
    const temp = `${file}.${process.pid}.${this.writes++}.tmp`
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temp, bytes)
    await rename(temp, file)
  }

  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true })
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const names = await readdir(this.file(prefix))
      return names.filter((name) => !name.endsWith('.tmp')).map((name) => `${prefix}/${name}`)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  /** Keys are a closed alphabet with no dot-led segment, so a key cannot leave the root. */
  private file(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`invalid store key: ${key}`)
    return join(this.root, key)
  }
}

export interface R2Config {
  bucket: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

const EMPTY_SHA256 = createHash('sha256').digest('hex')

/** A path segment as SigV4 canonicalizes it: RFC 3986, unreserved characters left alone. */
function uriEncode(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * S3-compatible BlobStore implementation for Cloudflare R2 (or any S3-compatible service).
 * Uses AWS Signature Version 4 for authentication.
 */
export class R2BlobStore implements BlobStore {
  private readonly config: R2Config
  private readonly now: () => Date

  constructor(config: R2Config, now: () => Date = () => new Date()) {
    this.config = config
    this.now = now
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.request('GET', this.objectUrl(key))
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`R2 GET failed: ${response.status} ${response.statusText}`)
    }
    
    return new Uint8Array(await response.arrayBuffer())
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const response = await this.request('PUT', this.objectUrl(key), bytes)
    if (!response.ok) {
      throw new Error(`R2 PUT failed: ${response.status} ${response.statusText}`)
    }
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', this.objectUrl(key))
    if (!response.ok && response.status !== 404) {
      throw new Error(`R2 DELETE failed: ${response.status} ${response.statusText}`)
    }
  }

  async list(prefix: string): Promise<string[]> {
    const url = new URL(this.config.endpoint)
    url.pathname = `/${this.config.bucket}/`
    // As SigV4 canonicalizes it: sorted by name, values RFC 3986-encoded (URLSearchParams would send `+`).
    url.search = `list-type=2&prefix=${uriEncode(`${prefix}/`)}`
    
    const response = await this.request('GET', url)
    if (!response.ok) {
      throw new Error(`R2 LIST failed: ${response.status} ${response.statusText}`)
    }
    
    const text = await response.text()
    const keys: string[] = []
    const keyRegex = /<Key>([^<]+)<\/Key>/g
    
    let match = keyRegex.exec(text)
    while (match !== null) {
      keys.push(match[1])
      match = keyRegex.exec(text)
    }
    
    return keys
  }

  /** A signed request to the configured endpoint: its URL always comes from `objectUrl` or `list`. */
  private request(method: string, url: URL, body?: Uint8Array): Promise<Response> {
    return fetch(url, { method, headers: this.signRequest(method, url, body), body: body as BodyInit | undefined })
  }

  private objectUrl(key: string): URL {
    const url = new URL(this.config.endpoint)
    url.pathname = `/${uriEncode(this.config.bucket)}/${key.split('/').map(uriEncode).join('/')}`
    return url
  }

  /**
   * Sign an S3 request using AWS Signature Version 4.
   * This implements the canonical request signing process without external dependencies.
   * `fetch` sends the host header itself; it is signed all the same.
   */
  signRequest(method: string, url: URL, body?: Uint8Array): Record<string, string> {
    const amzDate = this.now().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_SHA256
    
    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    
    const canonicalRequest = [
      method,
      url.pathname,
      url.search.slice(1),
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n')
    
    const canonicalRequestHash = createHash('sha256').update(canonicalRequest).digest('hex')
    
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      canonicalRequestHash
    ].join('\n')
    
    const signingKey = this.getSignatureKey(
      this.config.secretAccessKey,
      dateStamp,
      this.config.region,
      's3'
    )
    
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex')
    
    const authorizationHeader = [
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`
    ].join(', ')
    
    return {
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      'Authorization': authorizationHeader
    }
  }

  private getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
    const kDate = createHmac('sha256', `AWS4${key}`).update(dateStamp).digest()
    const kRegion = createHmac('sha256', kDate).update(region).digest()
    const kService = createHmac('sha256', kRegion).update(service).digest()
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest()
    return kSigning
  }
}
