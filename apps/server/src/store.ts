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

/**
 * S3-compatible BlobStore implementation for Cloudflare R2 (or any S3-compatible service).
 * Uses AWS Signature Version 4 for authentication.
 */
export class R2BlobStore implements BlobStore {
  private readonly config: R2Config

  constructor(config: R2Config) {
    this.config = config
  }

  async get(key: string): Promise<Uint8Array | null> {
    const url = this.objectUrl(key)
    const headers = this.signRequest('GET', url, '')
    
    const response = await fetch(url, { method: 'GET', headers })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`R2 GET failed: ${response.status} ${response.statusText}`)
    }
    
    return new Uint8Array(await response.arrayBuffer())
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const url = this.objectUrl(key)
    const headers = this.signRequest('PUT', url, '', bytes)
    
    const response = await fetch(url, { 
      method: 'PUT', 
      headers, 
      body: bytes as BodyInit
    })
    
    if (!response.ok) {
      throw new Error(`R2 PUT failed: ${response.status} ${response.statusText}`)
    }
  }

  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key)
    const headers = this.signRequest('DELETE', url, '')
    
    const response = await fetch(url, { method: 'DELETE', headers })
    if (!response.ok && response.status !== 404) {
      throw new Error(`R2 DELETE failed: ${response.status} ${response.statusText}`)
    }
  }

  async list(prefix: string): Promise<string[]> {
    const url = new URL(this.config.endpoint)
    url.pathname = `/${this.config.bucket}/`
    url.searchParams.set('list-type', '2')
    url.searchParams.set('prefix', `${prefix}/`)
    
    const headers = this.signRequest('GET', url.toString(), url.search)
    
    const response = await fetch(url.toString(), { method: 'GET', headers })
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

  private objectUrl(key: string): string {
    const url = new URL(this.config.endpoint)
    url.pathname = `/${this.config.bucket}/${key}`
    return url.toString()
  }

  /**
   * Sign an S3 request using AWS Signature Version 4.
   * This implements the canonical request signing process without external dependencies.
   */
  private signRequest(
    method: string,
    url: string,
    queryString: string,
    body?: Uint8Array
  ): Record<string, string> {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    
    const parsedUrl = new URL(url)
    const host = parsedUrl.host
    const canonicalUri = parsedUrl.pathname
    const canonicalQueryString = queryString.startsWith('?') ? queryString.slice(1) : queryString
    
    const payloadHash = body 
      ? createHash('sha256').update(body).digest('hex')
      : createHash('sha256').update('').digest('hex')
    
    const canonicalHeaders = `host:${host}\\nx-amz-content-sha256:${payloadHash}\\nx-amz-date:${amzDate}\\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\\n')
    
    const canonicalRequestHash = createHash('sha256').update(canonicalRequest).digest('hex')
    
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      canonicalRequestHash
    ].join('\\n')
    
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
      'Host': host,
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
