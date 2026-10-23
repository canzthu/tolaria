import { useEffect, useRef, useState } from "react";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";

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

/**
 * Opens a Yjs collaborative document for the given note path.
 * Returns null when collaboration is not available (desktop) or not enabled.
 * Manages the document lifecycle: opens on mount/path change, closes on unmount.
 */
export function useCollabDocument({
	vaultBackend,
	path,
	enabled,
}: UseCollabDocumentOptions): CollabDocumentState {
	const [doc, setDoc] = useState<VaultCollabDoc<RemoteBindings> | null>(null);
	const [synced, setSynced] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const currentPathRef = useRef<string | null>(null);
	const docRef = useRef<VaultCollabDoc<RemoteBindings> | null>(null);

	useEffect(() => {
		// Early return if not enabled or collaboration not available
		if (!enabled || !vaultBackend?.collab || !path) {
			// Clean up in the cleanup function, not synchronously
			currentPathRef.current = null;
			return () => {
				const prevDoc = docRef.current;
				if (prevDoc) {
					prevDoc.close();
					docRef.current = null;
				}
				setDoc(null);
				setSynced(false);
				setError(null);
			};
		}

		// Skip if path hasn't changed
		if (currentPathRef.current === path) {
			return;
		}

		// Path changed: mark as cancelled and schedule cleanup
		let cancelled = false;

		// Close previous doc before opening new one
		const prevDoc = docRef.current;
		if (prevDoc && currentPathRef.current !== path) {
			prevDoc.close();
			docRef.current = null;
			// State will be updated by the new doc opening, no need to reset here
		}

		async function openDocument() {
			try {
				if (!vaultBackend?.collab || !path) return;

				const collabDoc = await vaultBackend.collab.openDoc(path);

				if (cancelled) {
					collabDoc.close();
					return;
				}

				docRef.current = collabDoc;
				currentPathRef.current = path;
				setDoc(collabDoc);
				setError(null);

				// Wait for initial sync
				try {
					await collabDoc.synced;
					if (!cancelled) {
						setSynced(true);
					}
				} catch (syncError) {
					if (!cancelled) {
						setError(
							syncError instanceof Error
								? syncError
								: new Error(String(syncError)),
						);
					}
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err : new Error(String(err)));
					setDoc(null);
					setSynced(false);
				}
			}
		}

		void openDocument();

		return () => {
			cancelled = true;
			const currentDoc = docRef.current;
			if (currentDoc) {
				currentDoc.close();
				docRef.current = null;
			}
		};
	}, [vaultBackend, path, enabled]);

	return { doc, synced, error };
}
