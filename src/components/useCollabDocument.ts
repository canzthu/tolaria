import { useEffect, useState } from "react";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
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

type OpenedDocument = CollabDocumentState & { path: string };

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

function openCollabDocument(
	collab: VaultCollabChannel<RemoteBindings>,
	path: string,
	report: (state: CollabDocumentState) => void,
): () => void {
	let left = false;
	let opened: VaultCollabDoc<RemoteBindings> | null = null;
	const update = (state: CollabDocumentState) => {
		if (!left) report(state);
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

	return () => {
		left = true;
		opened?.close();
	};
}

/**
 * Opens a Yjs collaborative document for the given note path.
 * Returns no document when collaboration is not available (desktop) or not enabled.
 * Manages the document lifecycle: opens on mount/path change, closes on unmount.
 * The state always belongs to `path`: while another note's document is still open or
 * closing, the hook reports no document rather than the previous note's.
 */
export function useCollabDocument({
	vaultBackend,
	path,
	enabled,
}: UseCollabDocumentOptions): CollabDocumentState {
	const [opened, setOpened] = useState<OpenedDocument | null>(null);
	const collab = enabled ? collabChannel(vaultBackend) : null;
	const target = collab ? path : null;

	useEffect(() => {
		if (!collab || !target) return;
		const leave = openCollabDocument(collab, target, (state) =>
			setOpened({ ...state, path: target }),
		);
		return () => {
			leave();
			setOpened(null);
		};
	}, [collab, target]);

	return target && opened?.path === target ? opened : NO_DOCUMENT;
}
