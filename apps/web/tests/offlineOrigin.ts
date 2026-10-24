import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { REMOTE_URL } from "../playwright.config";

/**
 * A preview server for offline.spec.ts on its own origin, so the test can take the network
 * away for real: once it stops, every request fails, including the service worker's own.
 * Playwright's `setOffline` cannot stand in for this with a service worker: WebKit fails
 * every load before the worker sees it, and Chromium lets the worker's fetches through
 * after a navigation.
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OFFLINE_ORIGIN_PORT = process.env.TOLARIA_E2E_OFFLINE_PORT ?? "41762";
export const OFFLINE_ORIGIN = `http://127.0.0.1:${OFFLINE_ORIGIN_PORT}`;

async function isReachable(): Promise<boolean> {
	try {
		return (await fetch(OFFLINE_ORIGIN)).ok;
	} catch {
		return false;
	}
}

export class OfflineOrigin {
	private server: ChildProcess | null = null;

	/** The network comes back: the bundle and the `/v1` proxy answer again. */
	async start(): Promise<void> {
		this.server = spawn(
			"pnpm",
			["preview:web", "--port", OFFLINE_ORIGIN_PORT],
			{
				cwd: REPO_ROOT,
				detached: true,
				stdio: "ignore",
				env: { ...process.env, TOLARIA_REMOTE_URL: REMOTE_URL },
			},
		);
		await expect.poll(isReachable, { timeout: 30_000 }).toBe(true);
	}

	/** The network goes away: nothing on this origin answers any more. */
	async stop(): Promise<void> {
		const pid = this.server?.pid;
		this.server = null;
		if (pid) process.kill(-pid, "SIGTERM");
		await expect.poll(isReachable, { timeout: 15_000 }).toBe(false);
	}
}
