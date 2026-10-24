import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateActions } from "../hooks/useUpdater";
import { UpdateBanner } from "./UpdateBanner";

vi.mock("../hooks/useUpdater", async () => {
	const actual = await vi.importActual<typeof import("../hooks/useUpdater")>(
		"../hooks/useUpdater",
	);
	return { ...actual, restartApp: vi.fn() };
});

const values = new Map<string, string>();
const actions: UpdateActions = {
	startDownload: vi.fn(),
	openReleaseNotes: vi.fn(),
	dismiss: vi.fn(),
};

beforeEach(() => {
	values.clear();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});

describe("community banner", () => {
	it("shows while idle and keeps dismissal across remounts", () => {
		const first = render(
			<UpdateBanner status={{ state: "idle" }} actions={actions} />,
		);
		fireEvent.click(screen.getByTestId("community-banner-dismiss"));
		expect(screen.queryByTestId("community-banner")).not.toBeInTheDocument();
		first.unmount();
		render(<UpdateBanner status={{ state: "idle" }} actions={actions} />);
		expect(screen.queryByTestId("community-banner")).not.toBeInTheDocument();
	});

	it("gives an active update banner priority", () => {
		render(<UpdateBanner status={{ state: "checking" }} actions={actions} />);
		expect(screen.getByTestId("update-banner")).toBeInTheDocument();
		expect(screen.queryByTestId("community-banner")).not.toBeInTheDocument();
	});
});
