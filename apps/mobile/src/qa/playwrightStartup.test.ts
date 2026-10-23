import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("mobile Playwright startup", () => {
	it("loads the mobile Playwright config without parsing Expo's baseUrl:null config", () => {
		const result = spawnSync("pnpm", ["mobile:qa:screenshots", "--list"], {
			cwd: repositoryRoot,
			encoding: "utf8",
			timeout: 120_000,
		});

		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("mobile UI lab screenshots");
	}, 120_000);
});
