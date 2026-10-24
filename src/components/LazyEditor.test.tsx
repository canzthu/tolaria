import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorProps } from './Editor'

const startup = vi.hoisted(() => {
  const phases = new Map<string, { promise: Promise<void>, resolve: () => void }>()
  const phase = (name: string) => {
    let entry = phases.get(name)
    if (!entry) {
      let resolve!: () => void
      const promise = new Promise<void>((next) => { resolve = next })
      entry = { promise, resolve }
      phases.set(name, entry)
    }
    return entry
  }
  return {
    markStartupPhase: vi.fn(),
    phases,
    reach: (name: string) => phase(name).resolve(),
    waitForStartupPhase: vi.fn((name: string) => phase(name).promise),
  }
})

vi.mock('../lib/startupPerformance', () => ({
  markStartupPhase: startup.markStartupPhase,
  waitForStartupPhase: startup.waitForStartupPhase,
}))

const editorModule = vi.hoisted(() => {
  let resolve!: () => void
  const ready = new Promise<void>((next) => { resolve = next })
  return { ready, resolve }
})

vi.mock('./Editor', async () => {
  await editorModule.ready
  return { Editor: () => <div>Loaded editor</div> }
})

async function renderLazyEditor(activeTabPath: string | null) {
  const { LazyEditor } = await import('./LazyEditor')
  return { LazyEditor, ...render(<LazyEditor {...({ activeTabPath } as EditorProps)} />) }
}

function editorRequested(): boolean {
  return startup.markStartupPhase.mock.calls.some(([phase]) => phase === 'editor_module_requested')
}

describe('LazyEditor', () => {
  beforeEach(() => {
    vi.resetModules()
    startup.phases.clear()
    startup.markStartupPhase.mockClear()
    startup.waitForStartupPhase.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('keeps the app shell renderable while the editor bundle loads', async () => {
    const { LazyEditor, rerender } = await renderLazyEditor(null)

    expect(screen.getByTestId('editor-module-loading')).toBeInTheDocument()
    expect(startup.waitForStartupPhase).toHaveBeenCalledWith('react_shell')
    expect(editorRequested()).toBe(false)

    await act(async () => { startup.reach('react_shell') })
    expect(editorRequested()).toBe(true)

    rerender(<LazyEditor {...({ activeTabPath: '/vault/note.md' } as EditorProps)} />)

    await act(async () => { editorModule.resolve() })
    expect(await screen.findByText('Loaded editor')).toBeInTheDocument()
    expect(startup.markStartupPhase).toHaveBeenCalledWith('editor_module_loaded')
    expect(startup.markStartupPhase).toHaveBeenCalledWith('editor_committed')
  })

  it('on the web, waits for the cached note list to paint before it loads the editor bundle', async () => {
    vi.stubEnv('VITE_TOLARIA_WEB_BUILD', 'true')
    await renderLazyEditor(null)

    await act(async () => { startup.reach('react_shell') })
    expect(editorRequested()).toBe(false)

    await act(async () => {
      startup.reach('active_usable')
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(editorRequested()).toBe(true)
  })

  it('on the web, loads the editor bundle anyway when the vault is slow to become usable', async () => {
    vi.stubEnv('VITE_TOLARIA_WEB_BUILD', 'true')
    vi.useFakeTimers()
    await renderLazyEditor(null)

    await act(async () => { startup.reach('react_shell') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(editorRequested()).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(editorRequested()).toBe(true)
  })
})
