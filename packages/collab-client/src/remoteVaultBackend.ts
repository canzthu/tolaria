import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
	VAULT_BACKEND_INTERFACE_VERSION,
	type VaultBackend,
	type VaultCollabBindings,
	type VaultCollabDoc,
	type VaultCollabOpenOptions,
	type VaultFile,
	type VaultFileOps,
	type VaultSearchOptions,
	type VaultSearchResponse,
	type VaultWriteOptions,
	type VaultWriteResult,
} from "../../../src/lib/vaultBackend/types";
import type { SearchResult as AppSearchResult, VaultEntry as AppVaultEntry } from "../../../src/types";
import {
	COLLAB_TICKET_PARAM,
	type CollabTicketResponse,
	DOC_BLOCKS_FRAGMENT,
	DOC_ID_HEADER,
	type EntriesResponse,
	ROUTES,
	type SearchResponse,
	type SearchResult as ProtocolSearchResult,
	type VaultEntry as ProtocolVaultEntry,
} from "../../protocol/src/index.ts";
import { CollabProvider, type SocketLike } from "./collabProvider.ts";

/**
 * The Tolaria remote behind the `VaultBackend` seam: files over the HTTP protocol, and notes
 * as live documents over the collaboration channel. The spike implements what the
 * collaborative editor needs (read, write, open a document); the operations that depend on
 * the server's note index, which does not exist yet, are refused by name.
 */

export interface RemoteBindings extends VaultCollabBindings {
	doc: Y.Doc;
	fragment: Y.XmlFragment;
	provider: CollabProvider;
	awareness: Awareness;
}

export interface RemoteOptions {
	/** Origin of the server, or empty when it is served from the page's own origin. */
	baseUrl: string;
	token: string;
	fetch?: typeof fetch;
	/** Opens a websocket; the browser's `WebSocket` by default. */
	createSocket?: (url: string) => SocketLike;
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;

export class RemoteError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "RemoteError";
		this.status = status;
	}
}

function encoded(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

function etagOf(response: Response): string {
	return (response.headers.get("etag") ?? "").replaceAll('"', "");
}

async function ok(response: Response): Promise<Response> {
	if (response.ok) return response;
	throw new RemoteError(
		response.status,
		`the server answered ${response.status} for ${new URL(response.url).pathname}`,
	);
}

function precondition({
	baseRevision,
}: VaultWriteOptions): Record<string, string> {
	if (baseRevision === undefined) return { "if-match": "*" };
	if (baseRevision === null) return { "if-none-match": "*" };
	return { "if-match": `"${baseRevision}"` };
}

function unsupported(operation: string): () => Promise<never> {
	return () =>
		Promise.reject(
			new Error(`${operation} is not available on the Tolaria remote yet`),
		);
}

function mapProtocolEntryToApp(entry: ProtocolVaultEntry): AppVaultEntry {
	return {
		...entry,
		isA: entry.isA ?? null,
		aliases: entry.aliases ?? [],
		belongsTo: entry.belongsTo ?? [],
		relatedTo: [],
		status: entry.status ?? null,
		archived: false,
		modifiedAt: null,
		createdAt: null,
		relationships: entry.relationships ?? {},
		icon: null,
		color: null,
		order: null,
		sidebarLabel: null,
		template: null,
		sort: null,
		view: null,
		visible: true,
		organized: false,
		favorite: false,
		favoriteIndex: null,
		listPropertiesDisplay: [],
		outgoingLinks: entry.outgoingLinks ?? [],
		properties: {},
		fileKind: entry.fileKind ?? "markdown",
	};
}

function mapProtocolSearchResult(result: ProtocolSearchResult): AppSearchResult {
	return {
		path: result.path,
		title: result.path.split("/").pop()?.replace(/\.md$/, "") ?? "",
		snippet: result.matches[0]?.text ?? "",
		score: result.pathMatch ? 10 : 1,
		noteType: null,
	};
}

async function listEntries(request: Request): Promise<AppVaultEntry[]> {
	const response = await ok(await request(ROUTES.entries));
	const body = (await response.json()) as EntriesResponse;
	return body.entries.map(mapProtocolEntryToApp);
}

async function searchFiles(
	request: Request,
	query: string,
	options: VaultSearchOptions,
): Promise<VaultSearchResponse> {
	const limit = options.limit ?? 50;
	const url = `${ROUTES.search}?${new URLSearchParams({ q: query, limit: String(limit) })}`;
	const response = await ok(await request(url));
	const body = (await response.json()) as SearchResponse;
	const start = performance.now();
	return { results: body.results.map(mapProtocolSearchResult), elapsedMs: performance.now() - start };
}

async function deleteFiles(
	request: Request,
	paths: string[],
): Promise<string[]> {
	const deleted: string[] = [];
	for (const path of paths) {
		try {
			const file = await readFile(request, path);
			const init = {
				method: "DELETE",
				headers: { "if-match": `"${file.revision}"` },
			};
			await ok(await request(`${ROUTES.files}/${encoded(path)}`, init));
			deleted.push(path);
		} catch {
			// File doesn't exist or delete failed - skip it and continue
		}
	}
	return deleted;
}

function requester({
	baseUrl,
	token,
	fetch: send = fetch,
}: RemoteOptions): Request {
	return (path, init = {}) =>
		send(`${baseUrl}${path}`, {
			...init,
			headers: { ...init.headers, authorization: `Bearer ${token}` },
		});
}

async function readFile(request: Request, path: string): Promise<VaultFile> {
	const response = await ok(await request(`${ROUTES.files}/${encoded(path)}`));
	return { path, content: await response.text(), revision: etagOf(response) };
}

async function writeFile(
	request: Request,
	file: { path: string; content: string },
	options: VaultWriteOptions,
): Promise<VaultWriteResult> {
	const init = {
		method: "PUT",
		body: file.content,
		headers: precondition(options),
	};
	const response = await request(`${ROUTES.files}/${encoded(file.path)}`, init);
	// The server kept the bytes as a conflict copy; the file that won is what the caller needs.
	if (response.status === 409)
		return {
			status: "conflict",
			current: await readFile(request, file.path).catch(() => null),
		};
	return { status: "written", revision: etagOf(await ok(response)) };
}

function fileOps(request: Request): VaultFileOps {
	return {
		read: (path) => readFile(request, path),
		write: (path, content, options = {}) =>
			writeFile(request, { path, content }, options),
		list: () => listEntries(request),
		reload: () => listEntries(request),
		reloadEntry: unsupported("reloading a single entry"),
		rename: unsupported("renaming with link updates"),
		delete: (paths) => deleteFiles(request, paths),
		search: (query, options = {}) => searchFiles(request, query, options),
		saveAttachment: unsupported("uploading attachments"),
	};
}

function socketOrigin(baseUrl: string): string {
	return (baseUrl || globalThis.location.origin).replace(/^http/u, "ws");
}

async function docIdOf(request: Request, path: string): Promise<string> {
	const response = await ok(await request(`${ROUTES.files}/${encoded(path)}`));
	const docId = response.headers.get(DOC_ID_HEADER);
	if (!docId) throw new RemoteError(404, `${path} is not a note`);
	return docId;
}

/** A fresh ticket for every connection: a ticket opens one websocket. */
async function ticketUrl(
	request: Request,
	options: RemoteOptions,
	grant: { docId: string; access: string },
): Promise<string> {
	const response = await ok(
		await request(ROUTES.collabTickets, {
			method: "POST",
			body: JSON.stringify(grant),
		}),
	);
	const { path, ticket } = (await response.json()) as CollabTicketResponse;
	return `${socketOrigin(options.baseUrl)}${path}?${COLLAB_TICKET_PARAM}=${encodeURIComponent(ticket)}`;
}

async function openDoc(
	options: RemoteOptions,
	path: string,
	{ user, readOnly = false }: VaultCollabOpenOptions = {},
): Promise<VaultCollabDoc<RemoteBindings>> {
	const request = requester(options);
	const createSocket =
		options.createSocket ??
		((url: string) => new WebSocket(url) as unknown as SocketLike);
	const grant = {
		docId: await docIdOf(request, path),
		access: readOnly ? "read" : "write",
	};
	const doc = new Y.Doc();
	const provider = new CollabProvider({
		doc,
		openSocket: async () =>
			createSocket(await ticketUrl(request, options, grant)),
	});
	if (user) provider.awareness.setLocalStateField("user", user);
	return {
		path,
		doc,
		provider,
		fragment: doc.getXmlFragment(DOC_BLOCKS_FRAGMENT),
		awareness: provider.awareness,
		synced: provider.whenSynced(),
		close: () => {
			provider.destroy();
			doc.destroy();
		},
	};
}

export function createRemoteVaultBackend(
	options: RemoteOptions,
): VaultBackend<RemoteBindings> {
	return {
		kind: "remote",
		interfaceVersion: VAULT_BACKEND_INTERFACE_VERSION,
		capabilities: {
			collaboration: true,
			atomicRevisions: true,
			attachments: false,
		},
		files: fileOps(requester(options)),
		collab: {
			openDoc: (path, openOptions) => openDoc(options, path, openOptions),
		},
	};
}
