import { loadConfig } from './config.ts'
import { closeVaultServer, createVaultServer } from './server.ts'
import { LocalDiskStore, R2BlobStore, type BlobStore } from './store.ts'
import { Vault } from './vault.ts'

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`)
}

function createBlobStore(config: ReturnType<typeof loadConfig>): BlobStore {
  if (config.blobStore.type === 'local') {
    return new LocalDiskStore(config.blobStore.stateDir)
  }
  return new R2BlobStore(config.blobStore.config)
}

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  log('initializing vault')
  const vault = await Vault.open({
    dir: config.vaultDir,
    remoteUrl: config.remoteUrl,
    branch: config.branch,
    log,
  })
  log('vault initialized')
  const server = await createVaultServer({
    vault,
    store: createBlobStore(config),
    token: config.token,
    maxBodyBytes: config.maxBodyBytes,
    collab: config.collab ?? false,
    log,
    onReady: () => log('server ready'),
  })
  const stop = (): void => {
    log('shutdown signal received')
    closeVaultServer(server).catch((error: unknown) => {
      log(`shutdown failed: ${String(error)}`)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  server.listen(config.port, config.host, () => log(`tolaria server listening on http://${config.host}:${config.port}`))
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
