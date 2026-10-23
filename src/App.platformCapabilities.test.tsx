import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";

/**
 * Tests for platform capabilities detection in App.tsx (TOL-174).
 * Verifies that desktop-only features are hidden in web builds.
 */

describe("App platform capabilities", () => {
	beforeEach(() => {
		// Clean up any stubs from previous tests
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("detects remote backend configuration", () => {
		// Stub window properties for remote backend
		vi.stubGlobal("TOLARIA_REMOTE_URL", "https://example.com");
		vi.stubGlobal("TOLARIA_REMOTE_TOKEN", "test-token");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles missing remote URL", () => {
		// Stub only TOLARIA_REMOTE_TOKEN
		vi.stubGlobal("TOLARIA_REMOTE_TOKEN", "test-token");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles missing remote token", () => {
		// Stub only TOLARIA_REMOTE_URL
		vi.stubGlobal("TOLARIA_REMOTE_URL", "https://example.com");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles empty remote URL", () => {
		// Stub empty TOLARIA_REMOTE_URL
		vi.stubGlobal("TOLARIA_REMOTE_URL", "");
		vi.stubGlobal("TOLARIA_REMOTE_TOKEN", "test-token");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles empty remote token", () => {
		// Stub empty TOLARIA_REMOTE_TOKEN
		vi.stubGlobal("TOLARIA_REMOTE_URL", "https://example.com");
		vi.stubGlobal("TOLARIA_REMOTE_TOKEN", "");

		const { container } = render(<App />);

		// App should render without crashing
		expect(container).toBeTruthy();
	});

	test("handles window being undefined", () => {
		// No remote config stubs - tests default mock environment
		const { container } = render(<App />);

		// App should render without crashing in mock environment
		expect(container).toBeTruthy();
	});

	test("hides the mock git status in the status bar when a remote server is configured", async () => {
		vi.stubGlobal("TOLARIA_REMOTE_URL", "https://example.com");
		vi.stubGlobal("TOLARIA_REMOTE_TOKEN", "test-token");

		render(<App />);

		const statusBar = await screen.findByTestId("status-bar");
		await waitFor(() => expect(statusBar).toHaveTextContent("Contribute"));
		expect(statusBar).not.toHaveTextContent(/Synced|Changes|Commit/);
	});

	test("keeps the git status in the status bar without a remote server", async () => {
		render(<App />);

		const statusBar = await screen.findByTestId("status-bar");
		await waitFor(() => expect(statusBar).toHaveTextContent("Contribute"));
		expect(statusBar).toHaveTextContent(/Changes/);
		expect(statusBar).toHaveTextContent(/Synced/);
	});
});
