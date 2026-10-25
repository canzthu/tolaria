# Tolaria Web

The web target of Tolaria: the shared React/BlockNote shell in `src/`, built as a static web app with no Tauri runtime. AGPL-3.0-or-later, like the rest of this repository.

This directory holds build and test configuration only. It does not copy `src/`; it builds it.

| Command (from the repo root) | What it does |
|---|---|
| `pnpm build:web` | Builds the shell into `apps/web/dist` |
| `pnpm preview:web` | Serves `apps/web/dist` on `127.0.0.1:4173` |
| `pnpm playwright:web` | Checks the bundle in Chromium, WebKit, iPhone 15 and iPad emulation (build first) |
| `pnpm bench:web` | Big-vault bench: a 6,000-note vault against its budgets (build first; see `docs/PERFORMANCE.md`) |
| `pnpm test:web-config` | Unit tests for the preview options, the bench budgets and the Sentry build helpers |
| `pnpm upload:web-sourcemaps` | Uploads the hidden source maps of the last build to Sentry; skipped without `SENTRY_AUTH_TOKEN` ([telemetry](../../docs/web/telemetry.md)) |

| File | Purpose |
|---|---|
| `vite.config.ts` | Web build and preview config, layered on the root `vite.config.ts` |
| `previewOptions.ts` | Host, port and allowed-host resolution from `TOLARIA_WEB_*` |
| `playwright.config.ts`, `tests/` | Browser checks for the static bundle |
| `playwright.bench.config.ts`, `bench/`, `bigVaultBudgets.ts` | Big-vault performance bench and its budgets |
| `sentryWebBuild.ts`, `sourcemapUpload.ts`, `scripts/upload-sourcemaps.ts` | Web error telemetry: the build's own Sentry DSN and release, hidden source maps in `sourcemaps/` (never in `dist`), and their upload ([docs/web/telemetry.md](../../docs/web/telemetry.md)) |

Today the bundle runs on demo data from `src/mock-tauri/`. The remote backend that replaces it plugs in through `VaultBackend` (`src/lib/vaultBackend/`).

- Inventory, `VaultBackend`, collaboration notes and the server surface: [docs/web/s1-tauri-inventory.md](../../docs/web/s1-tauri-inventory.md)
- Testing on an iPad or iPhone: [docs/web/s2-device-test.md](../../docs/web/s2-device-test.md)
- Deliberate UI departures from desktop: [docs/web/ui-departures.md](../../docs/web/ui-departures.md)
- Decision record: [ADR 0185](../../docs/adr/0185-tolaria-web-target-and-vault-backend-seam.md)

The preview server binds to loopback by default. Read the safety rules in the device-test guide before binding it to any other address.

## Collaborative note page (spike S4, TOL-8)

`collab.html` is a second page of this build only: one note opened as a live document, with presence avatars, live cursors and a sync status. It talks to a [Tolaria server](../server/README.md) on its own origin; the preview server forwards `/v1` (websockets included) when `TOLARIA_REMOTE_URL` is set.

```bash
pnpm build:web
TOLARIA_REMOTE_URL=http://127.0.0.1:8787 pnpm preview:web
# http://127.0.0.1:4173/apps/web/collab.html?note=welcome.md
```

`pnpm playwright:web` runs the `collab` project too: it starts a server with a throwaway vault and has desktop Chromium, desktop WebKit and an iPhone viewport edit one note at once. See `docs/web/s4-spike-report.md`.
