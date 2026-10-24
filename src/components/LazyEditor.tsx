import { useEffect, useState, type ComponentType } from 'react'
import type { EditorProps } from './Editor'
import { EditorStartupFallback } from './EditorStartupFallback'
import { markStartupPhase, waitForStartupPhase } from '../lib/startupPerformance'

let editorModulePromise: Promise<{ Editor: ComponentType<EditorProps> }> | null = null

/** How long the web waits for the cached note list before it loads the editor anyway. */
const WEB_LIST_FIRST_LIMIT_MS = 1500

function isWebBuild(): boolean {
  return import.meta.env.VITE_TOLARIA_WEB_BUILD === 'true'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function afterNextFrame(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => { setTimeout(resolve, 0) }) })
}

/**
 * With no note open, the editor bundle waits for the shell. On the web it also waits for the
 * cached note list and one frame: evaluating the bundle first held the list's first paint back.
 */
async function waitForEditorTurn(): Promise<void> {
  await waitForStartupPhase('react_shell')
  if (!isWebBuild()) return
  await Promise.race([waitForStartupPhase('active_usable'), delay(WEB_LIST_FIRST_LIMIT_MS)])
  await afterNextFrame()
}

function loadEditorModule(): Promise<{ Editor: ComponentType<EditorProps> }> {
  editorModulePromise ??= (() => {
    markStartupPhase('editor_module_requested')
    return import('./Editor').then((module) => {
      markStartupPhase('editor_module_loaded')
      return module
    })
  })()
  return editorModulePromise
}

function LoadedEditor(props: EditorProps & { Editor: ComponentType<EditorProps> }) {
  const { Editor, ...editorProps } = props
  useEffect(() => { markStartupPhase('editor_committed') }, [])
  return <Editor {...editorProps} />
}

function commitLoadedEditor(
  lifecycle: AbortController,
  setEditor: (value: ComponentType<EditorProps>) => void,
  Editor: ComponentType<EditorProps>,
): void {
  if (!lifecycle.signal.aborted) setEditor(Editor)
}

export function LazyEditor(props: EditorProps) {
  const [Editor, setEditor] = useState<ComponentType<EditorProps> | null>(null)

  useEffect(() => {
    const lifecycle = new AbortController()
    void (async () => {
      if (!props.activeTabPath) await waitForEditorTurn()
      if (lifecycle.signal.aborted) return
      const module = await loadEditorModule()
      commitLoadedEditor(lifecycle, (Editor) => { setEditor(() => Editor) }, module.Editor)
    })()
    return () => { lifecycle.abort() }
  }, [props.activeTabPath])

  return Editor ? <LoadedEditor Editor={Editor} {...props} /> : <EditorStartupFallback {...props} />
}
