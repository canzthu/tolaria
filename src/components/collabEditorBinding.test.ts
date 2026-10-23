import { describe, expect, it } from "vitest";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import { resolvePlatformCapabilities } from "../lib/platformCapabilities";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";
import {
	collabEditorKey,
	collabNotePath,
	resolveCollabEditorBinding,
} from "./collabEditorBinding";

const web = resolvePlatformCapabilities("remote");
const desktop = resolvePlatformCapabilities("tauri");
const backend = {
	collab: { openDoc: async () => doc },
} as unknown as VaultBackend<RemoteBindings>;
const doc = { path: "note.md" } as VaultCollabDoc<RemoteBindings>;

function tab(
	path: string,
	content = "# Note\n",
	fileKind: "markdown" | "binary" = "markdown",
) {
	return { entry: { path, display: null, fileKind }, content };
}

const tabs = [tab("note.md"), tab("photo.png", "", "binary")];

function notePath(overrides: Partial<Parameters<typeof collabNotePath>[0]>) {
	return collabNotePath({
		tabs,
		activeTabPath: "note.md",
		vaultBackend: backend,
		platformCapabilities: web,
		...overrides,
	});
}

const LOCAL_CASES: [string, Partial<Parameters<typeof collabNotePath>[0]>][] = [
	["desktop", { platformCapabilities: desktop }],
	[
		"no collaboration channel",
		{ vaultBackend: { collab: null } as VaultBackend<RemoteBindings> },
	],
	["no backend", { vaultBackend: null }],
	["a tab that has not loaded", { activeTabPath: "other.md" }],
	["a binary file", { activeTabPath: "photo.png" }],
	[
		"a note shown as a sheet",
		{
			tabs: [
				{
					entry: { path: "note.md", display: "sheet", fileKind: "markdown" },
					content: "| a |\n",
				},
			],
		},
	],
];

describe("collabNotePath", () => {
	it("opens markdown notes on the web", () => {
		expect(notePath({})).toBe("note.md");
	});

	it.each(LOCAL_CASES)("keeps the note local for %s", (_label, overrides) => {
		expect(notePath(overrides)).toBeNull();
	});
});

describe("resolveCollabEditorBinding", () => {
	it("is local without a path or after an error", () => {
		expect(
			resolveCollabEditorBinding(null, {
				doc: null,
				synced: false,
				error: null,
			}),
		).toEqual({ kind: "local" });
		expect(
			resolveCollabEditorBinding("note.md", {
				doc,
				synced: false,
				error: new Error("x"),
			}),
		).toEqual({ kind: "local" });
	});

	it("is pending until the document has synced, then bound", () => {
		expect(
			resolveCollabEditorBinding("note.md", {
				doc: null,
				synced: false,
				error: null,
			}),
		).toEqual({ kind: "pending" });
		expect(
			resolveCollabEditorBinding("note.md", {
				doc,
				synced: false,
				error: null,
			}),
		).toEqual({ kind: "pending" });
		expect(
			resolveCollabEditorBinding("note.md", { doc, synced: true, error: null }),
		).toEqual({ kind: "bound", doc });
	});
});

describe("collabEditorKey", () => {
	it("keeps one shared editor on desktop", () => {
		expect(collabEditorKey(false, "a.md", { kind: "local" })).toBe(
			"shared-editor",
		);
		expect(collabEditorKey(undefined, "b.md", { kind: "bound", doc })).toBe(
			"shared-editor",
		);
	});

	it("creates a new web editor per note and again once it is bound", () => {
		expect(collabEditorKey(true, null, { kind: "local" })).toBe("editor-none");
		expect(collabEditorKey(true, "a.md", { kind: "pending" })).toBe(
			"editor-a.md",
		);
		expect(collabEditorKey(true, "a.md", { kind: "bound", doc })).toBe(
			"editor-a.md:collab",
		);
	});
});
