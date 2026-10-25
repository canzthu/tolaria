import type {
	VaultFolderRenameRequest,
	VaultFolderRenameResult,
} from "../../../src/lib/vaultBackend/types";
import type { FolderNode } from "../../../src/types";
import { isPortableName } from "../../../src/utils/portableName";
import {
	type FolderRenameRequest,
	ROUTES,
} from "../../protocol/src/index.ts";
import {
	assertVaultPath,
	jsonWithStrings,
	malformed,
	ok,
	RemoteError,
	type Request,
} from "./remoteHttp.ts";
import { followMoves, type Move, rewrittenCount } from "./remoteNoteLifecycle.ts";

/**
 * Folders on the Tolaria remote. Git keeps no empty folder, so the folder tree is the
 * folders of the vault's tracked files, hidden as the desktop's tree hides them (dot
 * folders and `type/`). A folder rename is one commit on the server (protocol 1.7) that
 * moves every file in it and rewrites the links that reach a moved note by its path.
 */

/** Folders the desktop's tree leaves out (`is_folder_tree_hidden_dir`). */
function isHiddenFolder(name: string): boolean {
	return name.startsWith(".") || name === "type";
}

function byName(a: FolderNode, b: FolderNode): number {
	const left = a.name.toLowerCase();
	const right = b.name.toLowerCase();
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

/** The folders above a file, outermost first, up to the first hidden one. */
function visibleFolders(path: string): string[] {
	const segments = path.split("/").slice(0, -1);
	const hidden = segments.findIndex(isHiddenFolder);
	const visible = hidden < 0 ? segments : segments.slice(0, hidden);
	return visible.map((_, depth) => visible.slice(0, depth + 1).join("/"));
}

function folderNode(path: string): FolderNode {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, children: [] };
}

/** The folder tree of the given file paths, sorted by name like the desktop's. */
export function folderTree(paths: readonly string[]): FolderNode[] {
	const nodes = new Map<string, FolderNode>();
	for (const folder of paths.flatMap(visibleFolders))
		if (!nodes.has(folder)) nodes.set(folder, folderNode(folder));
	const roots: FolderNode[] = [];
	for (const node of nodes.values()) {
		const parent = nodes.get(node.path.slice(0, Math.max(node.path.lastIndexOf("/"), 0)));
		(parent ? parent.children : roots).push(node);
	}
	for (const node of nodes.values()) node.children.sort(byName);
	return roots.sort(byName);
}

function filePaths(body: unknown): string[] {
	const files = (body as { files?: unknown } | null)?.files;
	if (!Array.isArray(files)) throw malformed("file list");
	return files.map((file: { path?: unknown }) => {
		if (typeof file?.path !== "string") throw malformed("file list");
		return file.path;
	});
}

/** `GET /v1/files`, as the folder tree. */
export async function listFolders(request: Request): Promise<FolderNode[]> {
	const response = await ok(await request(ROUTES.files));
	return folderTree(filePaths(await response.json()));
}

function siblingPath(folderPath: string, name: string): string {
	const parent = folderPath.slice(0, folderPath.lastIndexOf("/") + 1);
	return `${parent}${name}`;
}

function movesOf(result: Record<string, unknown>): Move[] {
	return Array.isArray(result.moved) ? (result.moved as Move[]) : [];
}

/**
 * Renames a folder in place, as the desktop's `rename_vault_folder` does, with its errors:
 * a name Windows cannot hold and a name already taken are refused. Live documents of the
 * moved notes follow their files.
 */
export async function renameFolder(
	request: Request,
	{ folderPath, newName }: VaultFolderRenameRequest,
): Promise<VaultFolderRenameResult> {
	assertVaultPath(folderPath);
	const name = newName.trim();
	if (!isPortableName(name)) throw new RemoteError(400, "Invalid folder name");
	const to = siblingPath(folderPath, name);
	if (to === folderPath) return { oldPath: folderPath, newPath: to, updatedFiles: 0 };
	const body: FolderRenameRequest = { from: folderPath, to, rewriteLinks: true };
	const response = await request(ROUTES.folderRename, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (response.status === 409) throw new RemoteError(409, `Folder '${to}' already exists`);
	const result = await jsonWithStrings(await ok(response), ["path"], "folder rename result");
	followMoves(movesOf(result));
	return { oldPath: folderPath, newPath: result.path, updatedFiles: rewrittenCount(result) };
}
