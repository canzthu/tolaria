import { invoke } from "@tauri-apps/api/core";
import { createRemoteVaultBackend } from "../../../packages/collab-client/src/remoteVaultBackend";
import { isTauri, mockInvoke } from "../../mock-tauri";
import { createCommandVaultBackend } from "./commandVaultBackend";
import type { VaultBackend } from "./types";

export type {
	CommandDialect,
	CommandInvoker,
	CommandVaultBackendOptions,
} from "./commandVaultBackend";
export { createCommandVaultBackend } from "./commandVaultBackend";
export { contentRevision } from "./contentRevision";
export * from "./types";

interface RemoteVaultConfig {
	serverUrl: string;
	token: string;
}

function getRemoteVaultConfig(): RemoteVaultConfig | null {
	if (
		typeof window === "undefined" ||
		!("TOLARIA_REMOTE_URL" in window) ||
		!("TOLARIA_REMOTE_TOKEN" in window)
	) {
		return null;
	}
	const serverUrl = (window as { TOLARIA_REMOTE_URL?: string })
		.TOLARIA_REMOTE_URL;
	const token = (window as { TOLARIA_REMOTE_TOKEN?: string })
		.TOLARIA_REMOTE_TOKEN;
	if (!serverUrl || !token) return null;
	return { serverUrl, token };
}

/** The desktop path: Tauri commands backed by the Rust vault crate. */
export function createTauriVaultBackend(vaultPath: string): VaultBackend {
	return createCommandVaultBackend({ dialect: "tauri", invoke, vaultPath });
}

/** The browser path: mock data, or the dev vault API when it is running. */
export function createMockVaultBackend(vaultPath: string): VaultBackend {
	return createCommandVaultBackend({
		dialect: "mock",
		invoke: mockInvoke,
		vaultPath,
	});
}

/**
 * Picks the backend for the current runtime. When a remote server is configured
 * (TOLARIA_REMOTE_URL and TOLARIA_REMOTE_TOKEN on window), uses the remote backend.
 * Otherwise falls back to Tauri (desktop) or mock (browser).
 */
export function createVaultBackend(vaultPath: string): VaultBackend {
	if (isTauri()) return createTauriVaultBackend(vaultPath);

	const remoteConfig = getRemoteVaultConfig();
	if (remoteConfig) {
		return createRemoteVaultBackend({
			baseUrl: remoteConfig.serverUrl,
			token: remoteConfig.token,
		});
	}

	return createMockVaultBackend(vaultPath);
}
