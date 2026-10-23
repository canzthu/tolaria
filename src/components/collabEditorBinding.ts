import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import type { PlatformCapabilities } from "../lib/platformCapabilities";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";
import type { VaultEntry } from "../types";
import { noteDisplaysAsSheet } from "../utils/noteFormat";
import {
	type CollabDocumentState,
	useCollabDocument,
} from "./useCollabDocument";

/**
 * How the rich editor of the active note gets and keeps its content:
 *  - `local`: from the tab's markdown, saved through `onContentChange` (desktop, mock web,
 *    sheets, or a note whose live document could not be opened);
 *  - `pending`: the note's live document is opening; the editor shows nothing yet and loads
 *    or saves nothing, so it cannot race the document;
 *  - `bound`: BlockNote edits the live document's shared fragment, which the server writes
 *    to the file. The tab-swap content load and `onContentChange` saves stay off.
 */
export type CollabEditorBinding =
	| { kind: "local" }
	| { kind: "pending" }
	| { kind: "bound"; doc: VaultCollabDoc<RemoteBindings> };

interface CollabTab {
	entry: Pick<VaultEntry, "path" | "display" | "fileKind">;
	content: string;
}

interface CollabEditorBindingOptions {
	tabs: CollabTab[];
	activeTabPath: string | null;
	vaultBackend?: VaultBackend<RemoteBindings> | null;
	platformCapabilities?: PlatformCapabilities;
}

const LOCAL: CollabEditorBinding = { kind: "local" };
const PENDING: CollabEditorBinding = { kind: "pending" };

/** The note path to open as a live document, or null when the note stays local. */
export function collabNotePath({
	tabs,
	activeTabPath,
	vaultBackend,
	platformCapabilities,
}: CollabEditorBindingOptions): string | null {
	if (!platformCapabilities?.perNoteEditors || !vaultBackend?.collab)
		return null;
	const activeTab = tabs.find((tab) => tab.entry.path === activeTabPath);
	if (!activeTab?.entry.path.toLowerCase().endsWith(".md")) return null;
	const isSheet = noteDisplaysAsSheet({
		content: activeTab.content,
		display: activeTab.entry.display,
		fileKind: activeTab.entry.fileKind,
	});
	return isSheet ? null : activeTab.entry.path;
}

export function resolveCollabEditorBinding(
	path: string | null,
	state: CollabDocumentState,
): CollabEditorBinding {
	if (!path || state.error) return LOCAL;
	if (state.doc && state.synced) return { kind: "bound", doc: state.doc };
	return PENDING;
}

/** Opens the active note's live document when the platform edits notes collaboratively. */
export function useCollabEditorBinding(
	options: CollabEditorBindingOptions,
): CollabEditorBinding {
	const path = collabNotePath(options);
	const state = useCollabDocument({
		vaultBackend: options.vaultBackend ?? null,
		path,
		enabled: path !== null,
	});
	return resolveCollabEditorBinding(path, state);
}

/**
 * The key of the editor instance: a bound editor is a new instance, because BlockNote binds
 * to a document only when it is created.
 */
export function collabEditorKey(
	perNoteEditors: boolean | undefined,
	activeTabPath: string | null,
	binding: CollabEditorBinding,
): string {
	if (!perNoteEditors) return "shared-editor";
	const suffix = binding.kind === "bound" ? ":collab" : "";
	return `editor-${activeTabPath ?? "none"}${suffix}`;
}
