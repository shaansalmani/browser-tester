# Project Architecture (`PROJECT_ARCHITECTURE.md`)

Browser Tester is structured as a decoupled web application plus a loopback-only local browser automation companion.

---

## High-Level Component Diagram

```text
+-----------------------------------+        HTTP (REST / Polling)        +-------------------------------------+
|   React Dashboard (Browser UI)    |  <------------------------------->  |   Express Backend + SQLite (Port    |
|   src/App.tsx & src/components/*  |     /api/health, /api/tests, ...    |   3000) - server.ts & server/db.ts  |
+-----------------------------------+                                     +------------------+------------------+
                                                                                             |
                                                                           127.0.0.1:47120   |  Authenticated
                                                                           (X-Agent-Token)   |  HTTP + Callbacks
                                                                                             v
                                                                          +------------------+------------------+
                                                                          |   Local Chrome Agent (Your PC)      |
                                                                          |   server/standaloneAgent.ts         |
                                                                          |   server/localAgentInterface.ts     |
                                                                          |   server/playwrightManager.ts       |
                                                                          +------------------+------------------+
                                                                                             |
                                                                           Playwright +      |  Isolated Temp
                                                                           Chrome Binary     |  Profiles / Contexts
                                                                                             v
                                                                          +------------------+------------------+
                                                                          |   Google Chrome Windows             |
                                                                          |   (Normal or Incognito QA Runs)     |
                                                                          +-------------------------------------+
```

---

## Directory & Module Map

### Frontend (`src/`)
- `src/App.tsx`: Top-level state coordination, theme persistence (`dark` class), polling loop (`1.5s` while active sessions exist), and navigation between **Dashboard** and **Test Reports**.
- `src/api/client.ts`: Typed `fetch` wrapper for all `/api/*` endpoints.
- `src/types/testing.ts`: Shared TypeScript contracts used by both React UI and Node.js backend.
- `src/utils/format.ts`: Shared date/time formatting utilities.
- `src/components/`:
  - `TopBar.tsx`: Sticky header navigation and Dark/Light toggle.
  - `StatusOverview.tsx`: Interactive 6-state status counter strip (`pending`, `running`, `completed`, `failed`, `stopped`, `timed_out`).
  - `TestConfigForm.tsx`: Test Type, Target URL (with live allowlist & safety checks), Browser (`Chrome`), Quantity, Mode (`Normal`/`Incognito`), collapsible QA Scroll & Timeout parameters, ownership confirmation, and Generate / Retry controls.
  - `RunningSessionsPanel.tsx`: Live session/instance list, scroll progress bar, per-instance Stop, per-session Stop, and Stop All controls.
  - `TestHistoryPanel.tsx`: Searchable, filterable SQLite session history with expandable instance table and history management.
  - `TestReportsPage.tsx`: Dedicated detailed QA report inspector (page title, final URL, HTTP status, load duration, scroll heights, lazy-load flag, video visibility/playback errors, and retry controls).
  - `DomainsAndAgentSection.tsx`: Authorized Domains CRUD, Local Chrome Agent live status card, and Concurrency/Local Dev Settings form.

### Backend & Local Agent (`server.ts` & `server/`)
- `server.ts`: Express server (`PORT=3000`), security headers, rate limiters, API endpoints (`/api/health`, `/api/settings`, `/api/domains`, `/api/tests`, `/api/agent/sessions/:id/report`), and Vite middleware (dev) or static `dist/` serving (production).
- `server/config.ts`: Environment config, strict `127.0.0.1` enforcement, concurrency bounds, default QA parameters, and `X-Agent-Token` generation/verification.
- `server/db.ts`: SQLite initialization (`better-sqlite3` with WAL mode & foreign keys), schema migrations, transactional session/result persistence, and `reconcileAgentActiveInstances` crash recovery.
- `server/validation.ts`: URL validation, domain allowlist verification, abuse/ad/platform blocking, SSRF IP/DNS checks, QA config validation, and retry depth checks (`MAX_RETRY_ATTEMPTS = 3`).
- `server/chromeDetector.ts`: Cross-platform Google Chrome binary discovery (Linux, macOS, Windows, plus `CHROME_EXECUTABLE_PATH`).
- `server/localAgentInterface.ts`: HTTP server bound exclusively to `127.0.0.1:47120` with Origin/Host/Token checks, plus typed client helpers used by `server.ts`.
- `server/playwrightManager.ts`: Isolated Chrome launcher (Normal temp profile vs Incognito), Playwright network policy guards (`context.route`), page load metrics, controlled gradual scroll & lazy-load detector, HTML5 `<video>` QA inspector, timeout protection, external close handling, and profile cleanup.
- `server/standaloneAgent.ts`: Entry point for `npm run agent`, managing agent startup and graceful `SIGINT`/`SIGTERM` Chrome shutdown.

---

## SQLite Tables (`data/browser-tester.db`)
1. `authorized_domains`: Explicitly authorized hostnames, ownership notes, and timestamps.
2. `app_settings`: Persisted concurrency caps (`max_active_instances`, `max_quantity_per_session`) and `allow_local_dev_targets`.
3. `test_sessions`: Parent QA session configuration, status, retry lineage (`retry_of_session_id`, `retry_attempt`), `qa_config_json`, and agent command contract.
4. `test_results`: Per-Chrome-instance execution telemetry (`instance_uid`, HTTP status, load time, page title, final URL, scroll steps/heights/lazy-load flag, video visibility/playback status/error, timestamps).
