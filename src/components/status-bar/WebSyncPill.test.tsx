import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import type {
	CollabProvider,
	CollabStatus,
} from "../../../packages/collab-client/src/collabProvider";
import type { RemoteBindings } from "../../../packages/collab-client/src/remoteVaultBackend";
import { DOC_META, DOC_META_MAP } from "../../../packages/protocol/src/index";
import { publishActiveCollabDocument } from "../../lib/activeCollabDocument";
import type { VaultCollabDoc } from "../../lib/vaultBackend/types";
import { WebSyncPill } from "./WebSyncPill";

let withdraw: (() => void) | null = null;

function publishDocument(status: CollabStatus) {
	const doc = new Y.Doc();
	const provider = {
		status,
		onStatus: (listener: (next: CollabStatus) => void) => {
			listener(status);
			return () => {};
		},
	} as unknown as CollabProvider;
	withdraw = publishActiveCollabDocument({
		doc,
		provider,
	} as VaultCollabDoc<RemoteBindings>);
	return doc;
}

function renderPill(
	props: { isOffline?: boolean; isReloading?: boolean } = {},
) {
	render(
		<WebSyncPill
			isOffline={props.isOffline ?? false}
			isReloading={props.isReloading ?? false}
			locale="en"
		/>,
	);
	return screen.getByTestId("status-sync-pill");
}

describe("WebSyncPill", () => {
	afterEach(() => {
		withdraw?.();
		withdraw = null;
	});

	it("is synced with no note open and nothing loading", () => {
		const pill = renderPill();
		expect(pill).toHaveAttribute("data-state", "synced");
		expect(pill).toHaveTextContent("Synced");
		expect(pill).toHaveAttribute("title", "All changes synced");
	});

	it("syncs while the vault reloads in the background", () => {
		expect(renderPill({ isReloading: true })).toHaveAttribute(
			"data-state",
			"syncing",
		);
	});

	it("connects while the note's document is opened", () => {
		withdraw = publishActiveCollabDocument("opening");
		const pill = renderPill();
		expect(pill).toHaveAttribute("data-state", "connecting");
		expect(pill).toHaveTextContent("Connecting…");
	});

	it("follows the note's live document", () => {
		publishDocument("syncing");
		expect(renderPill()).toHaveAttribute("data-state", "syncing");
	});

	it("is offline, but not read-only, when the server is unreachable", () => {
		publishDocument("offline");
		const pill = renderPill();
		expect(pill).toHaveAttribute("data-state", "offline");
		expect(pill).not.toHaveAttribute("data-read-only");
		expect(pill).toHaveTextContent("Offline");
	});

	it("is offline without a network, read-only", () => {
		const pill = renderPill({ isOffline: true });
		expect(pill).toHaveAttribute("data-state", "offline");
		expect(pill).toHaveAttribute("data-read-only", "true");
		expect(pill).toHaveTextContent("Offline · read-only");
		expect(pill).toHaveAttribute(
			"title",
			"No internet connection. Notes are read-only until you reconnect.",
		);
	});

	it("names the conflict copy the server kept", () => {
		const doc = publishDocument("synced");
		const pill = renderPill();
		act(() =>
			doc.getMap<string>(DOC_META_MAP).set(DOC_META.conflictCopy, "idea 2.md"),
		);
		expect(pill).toHaveAttribute("data-state", "conflict");
		expect(pill).toHaveTextContent("Conflict");
		expect(pill.getAttribute("title")).toContain("idea 2.md");
	});
});
