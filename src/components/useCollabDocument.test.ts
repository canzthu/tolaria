import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";
import { useCollabDocument } from "./useCollabDocument";

describe("useCollabDocument", () => {
	let mockVaultBackend: VaultBackend;
	let mockDoc: VaultCollabDoc<RemoteBindings>;

	beforeEach(() => {
		mockDoc = {
			path: "test.md",
			doc: {} as RemoteBindings["doc"],
			fragment: {} as RemoteBindings["fragment"],
			provider: {} as RemoteBindings["provider"],
			awareness: {} as RemoteBindings["awareness"],
			synced: Promise.resolve(),
			close: vi.fn(),
		};

		mockVaultBackend = {
			kind: "remote",
			interfaceVersion: 1,
			capabilities: {
				collaboration: true,
				atomicRevisions: true,
				attachments: false,
			},
			files: {} as VaultBackend["files"],
			chrome: {} as VaultBackend["chrome"],
			collab: {
				openDoc: vi.fn().mockResolvedValue(mockDoc),
			},
		};
	});

	it("returns null when not enabled", () => {
		const { result } = renderHook(() =>
			useCollabDocument({
				vaultBackend: mockVaultBackend,
				path: "test.md",
				enabled: false,
			}),
		);

		expect(result.current.doc).toBeNull();
		expect(result.current.synced).toBe(false);
		expect(mockVaultBackend.collab?.openDoc).not.toHaveBeenCalled();
	});

	it("returns null when no collab support", () => {
		const noCollabBackend = { ...mockVaultBackend, collab: null };

		const { result } = renderHook(() =>
			useCollabDocument({
				vaultBackend: noCollabBackend,
				path: "test.md",
				enabled: true,
			}),
		);

		expect(result.current.doc).toBeNull();
		expect(result.current.synced).toBe(false);
	});

	it("returns null when no path provided", () => {
		const { result } = renderHook(() =>
			useCollabDocument({
				vaultBackend: mockVaultBackend,
				path: null,
				enabled: true,
			}),
		);

		expect(result.current.doc).toBeNull();
		expect(result.current.synced).toBe(false);
		expect(mockVaultBackend.collab?.openDoc).not.toHaveBeenCalled();
	});

	it("opens document and waits for sync", async () => {
		const { result } = renderHook(() =>
			useCollabDocument({
				vaultBackend: mockVaultBackend,
				path: "test.md",
				enabled: true,
			}),
		);

		await waitFor(() => {
			expect(result.current.doc).toBe(mockDoc);
			expect(result.current.synced).toBe(true);
			expect(result.current.error).toBeNull();
		});

		expect(mockVaultBackend.collab?.openDoc).toHaveBeenCalledWith("test.md");
	});

	it("closes document on unmount", async () => {
		const { result, unmount } = renderHook(() =>
			useCollabDocument({
				vaultBackend: mockVaultBackend,
				path: "test.md",
				enabled: true,
			}),
		);

		await waitFor(() => {
			expect(result.current.doc).toBe(mockDoc);
		});

		unmount();

		expect(mockDoc.close).toHaveBeenCalled();
	});

	it("closes old document when path changes", async () => {
		const newMockDoc = { ...mockDoc, path: "new.md", close: vi.fn() };
		const openDoc = vi
			.fn()
			.mockResolvedValueOnce(mockDoc)
			.mockResolvedValueOnce(newMockDoc);

		const backend = { ...mockVaultBackend, collab: { openDoc } };

		const { result, rerender } = renderHook(
			({ path }) =>
				useCollabDocument({ vaultBackend: backend, path, enabled: true }),
			{ initialProps: { path: "test.md" } },
		);

		await waitFor(() => {
			expect(result.current.doc).toBe(mockDoc);
		});

		rerender({ path: "new.md" });

		await waitFor(() => {
			expect(mockDoc.close).toHaveBeenCalled();
			expect(result.current.doc).toBe(newMockDoc);
		});
	});

	it("handles sync errors gracefully", async () => {
		const syncError = new Error("Sync failed");
		const failingDoc = { ...mockDoc, synced: Promise.reject(syncError) };
		const openDoc = vi.fn().mockResolvedValue(failingDoc);
		const backend = { ...mockVaultBackend, collab: { openDoc } };

		const { result } = renderHook(() =>
			useCollabDocument({
				vaultBackend: backend,
				path: "test.md",
				enabled: true,
			}),
		);

		await waitFor(() => {
			expect(result.current.error).toEqual(syncError);
			expect(result.current.synced).toBe(false);
		});
	});

	it("handles openDoc errors gracefully", async () => {
		const openError = new Error("Failed to open");
		const openDoc = vi.fn().mockRejectedValue(openError);
		const backend = { ...mockVaultBackend, collab: { openDoc } };

		const { result } = renderHook(() =>
			useCollabDocument({
				vaultBackend: backend,
				path: "test.md",
				enabled: true,
			}),
		);

		await waitFor(() => {
			expect(result.current.error).toEqual(openError);
			expect(result.current.doc).toBeNull();
		});
	});
});
