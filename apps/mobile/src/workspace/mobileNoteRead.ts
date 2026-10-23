import { mobileNoteActionMode } from './mobileNoteActionMode'
import type { MobileWorkspaceEdit } from './mobileWorkspaceEditing'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import type { ReadOnlyWorkspaceRequest } from './readOnlyWorkspaceRepository'

type WorkspaceSource = ReadOnlyWorkspaceRequest['source']

export type MobileNoteReadState = {
  status: 'ready' | 'loading' | 'error'
  retry: () => void
}

export function mobileNoteNeedsRead(note: MobileNote | null, source: WorkspaceSource): boolean {
  if (!source || source === 'fixture' || !note) return false
  return note.rawContent === undefined && mobileNoteActionMode(note) !== 'binary-file'
}

export function isMobileNoteHydration(edit: MobileWorkspaceEdit): boolean {
  return edit.type === 'hydrateNoteContent' || edit.type === 'hydrateTextFileContent'
}

export function mobileEditNeedsNoteRead(edit: MobileWorkspaceEdit, snapshot: MobileWorkspaceSnapshot, source: WorkspaceSource): boolean {
  return mobileEditReadNotes(edit, snapshot, source).length > 0
}

export function mobileEditReadNotes(edit: MobileWorkspaceEdit, snapshot: MobileWorkspaceSnapshot, source: WorkspaceSource): MobileNote[] {
  if (isMobileNoteHydration(edit)) return []
  if (edit.type === 'bulkEdit') {
    const notes = edit.edits.flatMap((child) => mobileEditReadNotes(child, snapshot, source))
    return [...new Map(notes.map((note) => [note.id, note])).values()]
  }
  if (edit.type === 'moveFavorite') {
    return (snapshot.allNotes ?? snapshot.notes).filter((note) => note.favorite && mobileNoteNeedsRead(note, source))
  }
  return singleEditReadNotes(edit, snapshot, source)
}

function singleEditReadNotes(edit: MobileWorkspaceEdit, snapshot: MobileWorkspaceSnapshot, source: WorkspaceSource): MobileNote[] {
  const noteId = edit.type === 'createRelationshipTarget' ? edit.sourceNoteId : noteEditId(edit)
  if (!noteId) return []
  const note = snapshot.notes.find((item) => item.id === noteId)
    ?? snapshot.allNotes?.find((item) => item.id === noteId)
  return note && mobileNoteNeedsRead(note, source) ? [note] : []
}

function noteEditId(edit: MobileWorkspaceEdit): string | null {
  return 'noteId' in edit ? edit.noteId : null
}

export function startMobileNoteRead({ read, onContent, onError, timeoutMs }: {
  read: () => Promise<string | null>
  onContent: (content: string) => void
  onError: () => void
  timeoutMs?: number
}) {
  let cancelled = false
  let settled = false
  let timeout: ReturnType<typeof setTimeout>
  const isActive = () => !cancelled && !settled
  const finished = new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      resolve()
    }
    timeout = setTimeout(() => {
      if (isActive()) {
        settled = true
        onError()
      }
      finish()
    }, timeoutMs ?? 10_000)
    void readSelectedNote({
      isActive,
      markSettled: () => { settled = true },
      onContent,
      onError,
      read,
    }).finally(finish)
  })
  return { cancel: () => { cancelled = true; clearTimeout(timeout) }, finished }
}

async function readSelectedNote({ isActive, markSettled, onContent, onError, read }: {
  isActive: () => boolean
  markSettled: () => void
  onContent: (content: string) => void
  onError: () => void
  read: () => Promise<string | null>
}) {
  try {
    const content = await read()
    if (!isActive()) return
    markSettled()
    deliverNoteContent(content, onContent, onError)
  } catch {
    reportReadFailure(isActive, markSettled, onError)
  }
}

function deliverNoteContent(content: string | null, onContent: (content: string) => void, onError: () => void) {
  if (content === null) onError()
  else onContent(content)
}

function reportReadFailure(isActive: () => boolean, markSettled: () => void, onError: () => void) {
  if (!isActive()) return
  markSettled()
  onError()
}
