import {
	type Dispatch,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import {
	type ActiveCollabDocument,
	publishActiveCollabDocument,
} from "../lib/activeCollabDocument";
import type {
	VaultBackend,
	VaultCollabChannel,
	VaultCollabDoc,
} from "../lib/vaultBackend/types";

export interface CollabDocumentState {
	doc: VaultCollabDoc<RemoteBindings> | null;
	synced: boolean;
	error: Error | null;
}

interface UseCollabDocumentOptions {
	vaultBackend: VaultBackend<RemoteBindings> | null;
	path: string | null;
	enabled: boolean;
}

/** The state of one opened document, with the session that opened it. */
type OpenedDocument = CollabDocumentState & { session: DocumentSession };

const NO_DOCUMENT: CollabDocumentState = {
	doc: null,
	synced: false,
	error: null,
};

function collabChannel(
	vaultBackend: VaultBackend<RemoteBindings> | null,
): VaultCollabChannel<RemoteBindings> | null {
	return vaultBackend?.collab ?? null;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/** One opened document, which the hook keeps while its note is renamed. */
interface DocumentSession {
	collab: VaultCollabChannel<RemoteBindings>;
	/** The note the document belongs to: the backend moves `doc.path` on a rename from this page. */
	path(): string;
	leave(): void;
}

function openCollabDocument(
	collab: VaultCollabChannel<RemoteBindings>,
	path: string,
	report: (state: OpenedDocument) => void,
): DocumentSession {
	let left = false;
	let opened: VaultCollabDoc<RemoteBindings> | null = null;
	const session: DocumentSession = {
		collab,
		path: () => opened?.path ?? path,
		leave: () => {
			left = true;
			opened?.close();
		},
	};
	const update = (state: CollabDocumentState) => {
		if (!left) report({ ...state, session });
	};

	collab
		.openDoc(path)
		.then((doc) => {
			if (left) return doc.close();
			opened = doc;
			update({ doc, synced: false, error: null });
			return doc.synced.then(
				() => update({ doc, synced: true, error: null }),
				(error: unknown) =>
					update({ doc, synced: false, error: asError(error) }),
			);
		})
		.catch((error: unknown) =>
			update({ doc: null, synced: false, error: asError(error) }),
		);

	return session;
}

function isOpenAt(
	session: DocumentSession | undefined | null,
	collab: VaultCollabChannel<RemoteBindings> | null,
	target: string | null,
): boolean {
	return session?.collab === collab && session.path() === target;
}

/**
 * Keeps one document open for `target`. A target the open document already moved to (a
 * rename from this page) keeps it; any other target closes it and opens the new one.
 */
function useDocumentSession(
	collab: VaultCollabChannel<RemoteBindings> | null,
	target: string | null,
	setOpened: Dispatch<SetStateAction<OpenedDocument | null>>,
): void {
	const sessionRef = useRef<DocumentSession | null>(null);

	useEffect(() => {
		if (isOpenAt(sessionRef.current, collab, target)) return;
		sessionRef.current?.leave();
		setOpened(null);
		sessionRef.current =
			collab && target ? openCollabDocument(collab, target, setOpened) : null;
	}, [collab, target, setOpened]);

	useEffect(() => () => sessionRef.current?.leave(), []);
}

/** What the status bar's sync pill reads: the document, or that one is being opened. */
function activeDocumentOf(
	target: string | null,
	state: CollabDocumentState,
): ActiveCollabDocument {
	if (state.doc) return state.doc;
	return target && !state.error ? "opening" : null;
}

function usePublishedDocument(document: ActiveCollabDocument): void {
	useEffect(() => publishActiveCollabDocument(document), [document]);
}

/**
 * Opens a Yjs collaborative document for the given note path.
 * Returns no document when collaboration is not available (desktop) or not enabled.
 * Manages the document lifecycle: opens on mount/path change, closes on unmount.
 * The state always belongs to `path`: while another note's document is still open or
 * closing, the hook reports no document rather than the previous note's. A note renamed from
 * this page keeps its open document, which followed the file. The document is published as
 * the active one while the hook holds it.
 */
export function useCollabDocument({
	vaultBackend,
	path,
	enabled,
}: UseCollabDocumentOptions): CollabDocumentState {
	const [opened, setOpened] = useState<OpenedDocument | null>(null);
	const collab = enabled ? collabChannel(vaultBackend) : null;
	const target = collab ? path : null;
	useDocumentSession(collab, target, setOpened);
	const state =
		opened && isOpenAt(opened.session, collab, target) ? opened : NO_DOCUMENT;
	usePublishedDocument(activeDocumentOf(target, state));
	return state;
}
