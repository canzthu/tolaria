import { useCallback, useEffect, useRef, useState } from 'react'
import { markNoteDiskValidated, mobileNoteNeedsLoad, mobileNoteValidationKey, startValidatedMobileNoteRead, type MobileNoteReadState } from '../workspace/mobileNoteRead'
import type { MobileWorkspaceEdit, MobileWorkspaceEditResult } from '../workspace/mobileWorkspaceEditing'
import type { MobileNote } from '../workspace/mobileWorkspaceModel'
import type { ReadOnlyWorkspaceRepository, ReadOnlyWorkspaceRequest } from '../workspace/readOnlyWorkspaceRepository'

export function useMobileNoteRead({ applyEdit, note, repository, request }: {
  applyEdit: (edit: MobileWorkspaceEdit) => MobileWorkspaceEditResult | null | Promise<MobileWorkspaceEditResult | null>
  note: MobileNote | null
  repository: ReadOnlyWorkspaceRepository
  request?: ReadOnlyWorkspaceRequest
}): MobileNoteReadState {
  const [failedNote, setFailedNote] = useState<MobileNote | null>(null)
  const [validatedNoteKey, setValidatedNoteKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const applyEditRef = useRef(applyEdit)
  const noteKey = mobileNoteValidationKey(note, request?.vaultRootUri)
  const needsRead = mobileNoteNeedsLoad(note, request?.source, validatedNoteKey, noteKey)
  useEffect(() => { applyEditRef.current = applyEdit }, [applyEdit])
  useEffect(() => {
    if (!note || !needsRead) return
    const operation = startValidatedMobileNoteRead({
      applyEdit: applyEditRef.current,
      note,
      onError: () => setFailedNote(note),
      onValidated: markNoteDiskValidated({ note, source: request?.source, validatedKey: validatedNoteKey, noteKey, setValidated: setValidatedNoteKey }),
      read: () => repository.readNoteContent(note, request),
    })
    return operation.cancel
  }, [attempt, needsRead, note, noteKey, repository, request, validatedNoteKey])

  const retry = useCallback(() => {
    setFailedNote(null)
    setAttempt((current) => current + 1)
  }, [])
  if (!needsRead) return { status: 'ready', retry }
  return { status: failedNote === note ? 'error' : 'loading', retry }
}
