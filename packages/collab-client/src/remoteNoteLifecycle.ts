import type {
	VaultRenameRequest,
	VaultRenameResult,
} from "../../../src/lib/vaultBackend/types";
import { slugifyNoteStem } from "../../../src/utils/noteSlug";
import { ROUTES } from "../../protocol/src/index.ts";
import {
	assertVaultPath,
	jsonWithStrings,
	ok,
	RemoteError,
	type Request,
} from "./remoteHttp.ts";

/**
 * Creating, renaming and following notes on the Tolaria remote. A note is created with
 * `If-None-Match: *`, so a note created at the same path elsewhere first is kept and this
 * one becomes a conflict copy. Renames move the file on the server, which keeps the note's
 * document id, so a live document open in this page follows its file instead of reopening.
 */

/** Most `<stem>-<n>.md` candidates tried before a rename gives up. */
const RENAME_ATTEMPTS = 50;

// Page-wide on purpose: the shell creates several backends for the one remote (one per
// call site), and a rename made through any of them must move documents opened by another.

/** Notes whose creating write is still in flight: their document cannot be found yet. */
const creating = new Map<string, Promise<unknown>>();

/** Live documents open in this page, by the path of their note. */
const openDocs = new Set<{ path: string }>();

/** Runs a note's creating write; opening that note's document waits for it. */
export function trackCreate<T>(path: string, write: Promise<T>): Promise<T> {
	const settled = write.catch(() => undefined);
	creating.set(path, settled);
	void settled.then(() => {
		if (creating.get(path) === settled) creating.delete(path);
	});
	return write;
}

/** Resolves once no write is creating `path`. */
export async function whenCreated(path: string): Promise<void> {
	await creating.get(path);
}

/** Keeps `doc.path` on its note through renames made from this page. Returns the release. */
export function followRenames(doc: { path: string }): () => void {
	openDocs.add(doc);
	return () => {
		openDocs.delete(doc);
	};
}

/** A note moving from one path to another. */
interface Move {
	from: string;
	to: string;
}

function moveOpenDocs({ from, to }: Move): void {
	for (const doc of openDocs) if (doc.path === from) doc.path = to;
}

/** The note to rename and the file stem it should get. */
interface RenameTarget {
	path: string;
	stem: string;
}

/** A stem names one file: no folder separators, no dot segments, not empty. */
const UNSAFE_STEM = /[/\\]|^\.{0,2}$/u;

function renameTarget(rename: VaultRenameRequest): RenameTarget {
	const stem =
		"newTitle" in rename
			? slugifyNoteStem(rename.newTitle)
			: rename.newFilenameStem.trim();
	if (UNSAFE_STEM.test(stem))
		throw new RemoteError(400, `"${stem}" is not a file name`);
	return { path: rename.path, stem };
}

/** The desktop's naming, in the note's folder: `<stem>.md`, then `<stem>-2.md`, `<stem>-3.md`, … */
export function renameCandidate(
	{ path, stem }: RenameTarget,
	attempt: number,
): string {
	const folder = path.slice(0, path.lastIndexOf("/") + 1);
	const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
	return `${folder}${stem}${suffix}.md`;
}

/** Resolves with the note's new path, or null when `to` is taken. */
async function moveTo(request: Request, move: Move): Promise<string | null> {
	const response = await request(ROUTES.rename, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(move),
	});
	if (response.status === 409) return null;
	const result = await jsonWithStrings(await ok(response), ["path"], "rename result");
	assertVaultPath(result.path);
	return result.path;
}

/** Renames a note within its folder to the first free name for the requested title or stem. */
export async function renameNote(
	request: Request,
	rename: VaultRenameRequest,
): Promise<VaultRenameResult> {
	assertVaultPath(rename.path);
	const target = renameTarget(rename);
	// Protocol 1.x moves the file only: wikilinks in other notes are not rewritten.
	const renamed = (newPath: string) => ({ newPath, updatedFiles: 0, failedUpdates: 0 });
	for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
		const to = renameCandidate(target, attempt);
		if (to === rename.path) return renamed(to);
		const moved = await moveTo(request, { from: rename.path, to });
		if (!moved) continue;
		moveOpenDocs({ from: rename.path, to: moved });
		return renamed(moved);
	}
	throw new RemoteError(409, `no free name for ${rename.path}`);
}
