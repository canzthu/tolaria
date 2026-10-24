import { type EditorBridge, TenTapStartKit, useEditorBridge } from '@10play/tentap-editor'
import { type MutableRefObject, useCallback, useMemo, useRef } from 'react'
import { mobileDocumentBody, mobileNoteEditableContent } from '../../workspace/mobileDocumentContent'
import { useNativeWysiwygAutocompleteProbe } from './MobileWysiwygAutocompleteProbe.native'
import { MobileCodeBlockBridge } from './MobileWysiwygCodeBlockBridge'
import { MobileDiagramBridge } from './MobileWysiwygDiagramBridge'
import { activateNativeEditorChanges, type NativeTentapEditorRefs, useEditableContentRef, useEditorBridgeRef, useEditorCssInjection, useFlushOnUnmount, useResetEditorChangeGate, useSyncInitialEditorContent } from './MobileWysiwygEditorLifecycle.native'
import { MobileMathInlineBridge } from './MobileWysiwygMathBridge'
import { MobileWysiwygContentBridge } from './MobileWysiwygContentBridge'
import { createMobileEditorDocumentBridge } from './MobileWysiwygDocumentReads.native'
import type { NativeInitialContentSync } from './nativeInitialContentSync'
import { MobileWysiwygOutlineBridge } from './MobileWysiwygOutlineBridge'
import { MobileWysiwygSlashBridge } from './MobileWysiwygSlashBridge'
import { MobileWysiwygFindBridge } from './MobileWysiwygFindBridge'
import { useMobileWysiwygOutlineNavigation } from './MobileWysiwygOutlineNavigation.native'
import { useFlushEditorDocument } from './MobileWysiwygPersistence.native'
import { MobileTableBridge } from './MobileWysiwygTableBridge'
import { mobileWysiwygTentapEditorHtml } from './MobileWysiwygTentapEditorHtml'
import { mobileEditorPreviewHtml } from './mobileEditorFileSource.native'
import type { NativeWysiwygSelection } from './MobileWysiwygWikilinkBridgeModel'
import type { MobileWysiwygMarkdownEditorProps, NativeTentapEditorBridgeOptions, NativeTentapEditorRuntime, TimerHandle, NativeWysiwygEditorMutation, NativeWysiwygInlineAutocompleteHandler } from './MobileNativeEditor.types'
import { detectNativeWysiwygInlineAutocomplete, insertWikilinkIntoNativeEditor, insertAttachmentIntoNativeEditor, insertMarkdownBlockIntoNativeEditor, insertPlainTextIntoNativeEditor, applyNativeWysiwygInputTransforms } from './mobileNativeEditorOperations'
import { useNativeWysiwygTextProbes, useNativeWysiwygBlockProbes } from './useMobileNativeEditorProbes'
import { retireNativeEditorSession } from './MobileWysiwygEditorLifecycle.native'

const mobileTenTapBridgeExtensions = [
  ...TenTapStartKit,
  MobileCodeBlockBridge,
  MobileDiagramBridge,
  MobileMathInlineBridge,
  MobileWysiwygContentBridge,
  MobileWysiwygOutlineBridge,
  MobileWysiwygSlashBridge,
  MobileWysiwygFindBridge,
  MobileTableBridge.configureExtension({ renderWrapper: true }),
]

export function initialNativeEditorContent(
  props: Pick<MobileWysiwygMarkdownEditorProps, 'blocks' | 'bullets' | 'note'>,
): string {
  const { blocks, bullets, note } = props
  return mobileNoteEditableContent({
    ...note,
    editorBlocks: note.editorBlocks ?? blocks,
    editorBullets: bullets,
  })
}

export function useNativeTentapEditorBridge(options: NativeTentapEditorBridgeOptions) {
  const runtime = useNativeTentapEditorRuntime(options)
  const { refs, flushEditorDocument, initialContent, injectEditorCss, scheduleEditorChange } = runtime
  const insertions = useNativeWysiwygInsertions(runtime)
  const editor = useEditorBridge({
    // The native viewport shrinks above the keyboard; do not inset the document twice.
    avoidIosKeyboard: false,
    bridgeExtensions: refs.documentReads.extensions,
    customSource: mobileWysiwygTentapEditorHtml,
    initialContent,
    onChange: scheduleEditorChange,
  })
  useNativeTentapEditorLifecycle(options, runtime, editor)
  useNativeWysiwygAutocompleteProbe({
    detectAutocomplete: detectNativeWysiwygInlineAutocomplete,
    enabled: options.wysiwygAutocompleteProbe === true,
    refs,
  })
  useMobileWysiwygOutlineNavigation({
    documentTitle: options.note.title,
    onProof: options.onTableOfContentsScrollProof,
    refs,
    target: options.tableOfContentsTarget,
  })
  useNativeWysiwygTextProbes(options, runtime)
  useNativeWysiwygBlockProbes(options, runtime)
  useFlushOnUnmount(refs, flushEditorDocument)
  return {
    ...insertions,
    activateEditorChanges: () => activateNativeEditorChanges(refs),
    editor,
    flushEditorDocument,
    injectEditorCss,
    retireEditor: () => retireNativeEditorSession(refs),
  }
}

export function useNativeTentapEditorRuntime(options: NativeTentapEditorBridgeOptions) {
  const {
    compact,
    initialDocumentContent,
    note,
    onInlineAutocomplete,
    onUpdateContent,
    vaultRootUri = null,
  } = options
  const initialBody = mobileDocumentBody(initialDocumentContent)
  const initialBodyHasContent = initialBody.trim().length > 0
  const initialContent = useMemo(
    () => mobileEditorPreviewHtml(initialBody, vaultRootUri),
    [initialBody, vaultRootUri],
  )
  const refs = useNativeTentapEditorRefs(initialDocumentContent)

  const flushEditorDocument = useFlushEditorDocument({
    externalLinkProbeEnabled: options.wysiwygExternalLinkProbe === true,
    initialBodyHasContent,
    markdownBlockProbeEnabled: options.wysiwygMarkdownBlockProbe === true,
    mutationProbeEnabled: options.wysiwygMutationProbe === true,
    noteId: note.id,
    onUpdateContent,
    refs,
    tableCommandMutationProbeEnabled: options.wysiwygTableCommandMutationProbe === true,
    vaultRootUri,
    wikilinkInsertProbeEnabled: options.wysiwygWikilinkInsertProbe === true,
  })
  const scheduleEditorChange = useScheduleEditorChange(refs, flushEditorDocument, onInlineAutocomplete)
  const injectEditorCss = useEditorCssInjection({
    compact,
    initialContent,
    noteWidth: note.noteWidth,
    refs,
  })
  return { refs, initialContent, flushEditorDocument, scheduleEditorChange, injectEditorCss }
}

function useNativeWysiwygInsertions({ refs, flushEditorDocument }: NativeTentapEditorRuntime) {
  const insertWikilink = useNativeWysiwygInserter({
    flushEditorDocument,
    insertIntoEditor: insertWikilinkIntoNativeEditor,
    refs,
    warning: '[mobile-editor] Failed to insert native WYSIWYG wikilink:',
  })
  const insertAttachment = useNativeWysiwygInserter({
    flushEditorDocument,
    insertIntoEditor: insertAttachmentIntoNativeEditor,
    refs,
    warning: '[mobile-editor] Failed to insert native WYSIWYG attachment:',
  })
  const insertMarkdownBlock = useNativeWysiwygInserter({
    flushEditorDocument,
    insertIntoEditor: insertMarkdownBlockIntoNativeEditor,
    refs,
    warning: '[mobile-editor] Failed to insert native WYSIWYG markdown block:',
  })
  const insertPlainText = useNativeWysiwygInserter({
    flushEditorDocument,
    insertIntoEditor: insertPlainTextIntoNativeEditor,
    refs,
    warning: '[mobile-editor] Failed to insert native WYSIWYG plain text:',
  })
  return { insertWikilink, insertAttachment, insertMarkdownBlock, insertPlainText }
}

function useNativeTentapEditorLifecycle(
  options: NativeTentapEditorBridgeOptions, { refs, initialContent }: NativeTentapEditorRuntime, editor: EditorBridge,
) {
  const { blocks, bullets, note } = options
  useEditorBridgeRef(refs.editorRef, editor)
  useEditableContentRef({ blocks, bullets, note, refs })
  useResetEditorChangeGate({ noteId: note.id, refs })
  useSyncInitialEditorContent({
    initialContent,
    noteId: note.id,
    onInitialContentSyncFailure: options.onInitialContentSyncFailure,
    refs,
  })
}

function useNativeTentapEditorRefs(initialDocumentContent: string): NativeTentapEditorRefs {
  const acceptsEditorChangesRef = useRef(false)
  const contentRef = useRef(initialDocumentContent)
  const editorRef = useRef<EditorBridge | null>(null)
  const firstEditorSerializationRef = useRef(true)
  const hasAcceptedEditorChangeRef = useRef(false)
  const initialContentSyncRef = useRef<NativeInitialContentSync | null>(null)
  const inlineAutocompleteTimerRef = useRef<TimerHandle | null>(null)
  const markdownBlockProofReadyRef = useRef(false)
  const markdownBlockRenderProofRef = useRef(false)
  const saveTimerRef = useRef<TimerHandle | null>(null)
  const tableCommandMutationProofReadyRef = useRef(false)
  const webViewLoadedRef = useRef(false)

  return useMemo(
    () => ({
      documentReads: createMobileEditorDocumentBridge(mobileTenTapBridgeExtensions),
      acceptsEditorChangesRef,
      contentRef,
      editorRef,
      firstEditorSerializationRef,
      hasAcceptedEditorChangeRef,
      initialContentSyncRef,
      inlineAutocompleteTimerRef,
      markdownBlockProofReadyRef,
      markdownBlockRenderProofRef,
      saveTimerRef,
      tableCommandMutationProofReadyRef,
      webViewLoadedRef,
    }),
    [],
  )
}

function useNativeWysiwygInserter<Payload>({
  flushEditorDocument,
  insertIntoEditor,
  refs,
  warning,
}: {
  flushEditorDocument: () => void
  insertIntoEditor: NativeWysiwygEditorMutation<Payload>
  refs: NativeTentapEditorRefs
  warning: string
}) {
  const { editorRef, hasAcceptedEditorChangeRef, saveTimerRef } = refs

  return useCallback(
    (payload: Payload, selection?: NativeWysiwygSelection) => {
      void insertIntoEditor(editorRef.current, payload, selection)
        .then((inserted) => {
          if (!inserted) return

          hasAcceptedEditorChangeRef.current = true
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
          saveTimerRef.current = setTimeout(flushEditorDocument, 250)
        })
        .catch((error: unknown) => {
          console.warn(warning, error)
        })
    },
    [editorRef, flushEditorDocument, hasAcceptedEditorChangeRef, insertIntoEditor, saveTimerRef, warning],
  )
}

function useScheduleEditorChange(
  refs: NativeTentapEditorRefs,
  flushEditorDocument: () => void,
  onInlineAutocomplete: NativeWysiwygInlineAutocompleteHandler,
) {
  const { acceptsEditorChangesRef, editorRef, hasAcceptedEditorChangeRef, inlineAutocompleteTimerRef, saveTimerRef } =
    refs

  return useCallback(() => {
    if (!acceptsEditorChangesRef.current) return
    hasAcceptedEditorChangeRef.current = true
    scheduleNativeWysiwygSave({ flushEditorDocument, saveTimerRef })
    if (inlineAutocompleteTimerRef.current) clearTimeout(inlineAutocompleteTimerRef.current)
    inlineAutocompleteTimerRef.current = setTimeout(() => {
      void applyNativeWysiwygInputTransforms(editorRef.current)
        .then((transformed) => {
          if (transformed) scheduleNativeWysiwygSave({ flushEditorDocument, saveTimerRef })
          return detectNativeWysiwygInlineAutocomplete(editorRef.current)
        })
        .then(onInlineAutocomplete)
        .catch((error: unknown) => {
          console.warn('[mobile-editor] Failed to run native WYSIWYG change handlers:', error)
        })
    }, 80)
  }, [
    acceptsEditorChangesRef,
    editorRef,
    flushEditorDocument,
    hasAcceptedEditorChangeRef,
    inlineAutocompleteTimerRef,
    onInlineAutocomplete,
    saveTimerRef,
  ])
}

function scheduleNativeWysiwygSave({
  flushEditorDocument,
  saveTimerRef,
}: {
  flushEditorDocument: () => void
  saveTimerRef: MutableRefObject<TimerHandle | null>
}) {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  saveTimerRef.current = setTimeout(flushEditorDocument, 250)
}
