import type { ServerResponse } from 'node:http'
import type { ChangeEvent } from '../../../packages/protocol/src/index.ts'

interface Connection {
  response: ServerResponse
  id: number
}

let nextId = 1

/**
 * Manages Server-Sent Events connections for the change feed.
 * Emits events when commits, pulls, and pushes occur.
 */
export class ChangeEmitter {
  private readonly connections = new Set<Connection>()
  private readonly log: (message: string) => void

  constructor(log?: (message: string) => void) {
    this.log = log ?? (() => {})
  }

  /** Register a new SSE connection. */
  connect(response: ServerResponse): void {
    const connection: Connection = { response, id: nextId++ }
    this.connections.add(connection)

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    response.on('close', () => {
      this.connections.delete(connection)
    })

    // Send initial connected event
    this.sendEvent(connection, { type: 'commit', head: 'connected' })
  }

  /** Emit an event to all connected clients. */
  emit(event: ChangeEvent): void {
    if (this.connections.size === 0) return

    const disconnected: Connection[] = []
    for (const connection of this.connections) {
      try {
        this.sendEvent(connection, event)
      } catch (error) {
        this.log(`failed to send event to connection ${connection.id}: ${String(error)}`)
        disconnected.push(connection)
      }
    }

    for (const connection of disconnected) {
      this.connections.delete(connection)
    }
  }

  /** Close all connections. */
  close(): void {
    for (const { response } of this.connections) {
      response.end()
    }
    this.connections.clear()
  }

  private sendEvent(connection: Connection, event: ChangeEvent): void {
    const data = JSON.stringify(event)
    connection.response.write(`data: ${data}\n\n`)
  }
}
