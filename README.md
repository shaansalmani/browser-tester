# Browser Tester

**Browser Tester** is a web-based Quality Assurance (QA) dashboard paired with a local companion Chrome agent (`127.0.0.1`). It enables website owners and QA engineers to launch isolated Google Chrome sessions (Normal or Incognito), inspect page loading, execute controlled gradual scrolling with lazy-load detection, verify video player health, and review persisted SQLite test reports.

> **Important Scope Notice**: Browser Tester is a **web application** with a separate local companion agent—not an Electron desktop app. It is strictly built for authorized QA testing on domains you own or hold explicit written permission to test. Artificial traffic, fake YouTube views/engagement, and ad interaction/clicks are strictly prohibited and blocked by architecture.

---

## Architecture Overview

1. **Web Dashboard (`src/`)**: React + TypeScript + Vite + Tailwind CSS v4 SPA with dark/light themes, live session/scroll progress, history filtering, and a dedicated Test Reports view.
2. **Backend API (`server.ts` + `server/`)**: Express + SQLite (`better-sqlite3`) backend handling input validation, SSRF/domain-allowlist enforcement, concurrency limits, rate limiting, and SQLite persistence.
3. **Local Chrome Agent (`server/standaloneAgent.ts`)**: Node.js + Playwright companion running strictly on `127.0.0.1:47120` on your PC. Launches isolated Chrome contexts (without touching your personal Chrome profile, passwords, cookies, or history) and streams QA progress back to the dashboard.

See [PROJECT_ARCHITECTURE.md](./PROJECT_ARCHITECTURE.md) and [SECURITY.md](./SECURITY.md) for detailed design and security documentation.

---

## Prerequisites

- **Node.js** `v20+` (verified with Node `v22`) and **npm**
- **Google Chrome** installed on the PC running the local agent (or `CHROME_EXECUTABLE_PATH` set in `.env`)

---

## Quick Start (Development)

1. **Install dependencies** (and Playwright browser binaries if needed, though Browser Tester uses your installed Google Chrome executable):
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env` if you need custom settings (optional—sensible defaults and auto-generated local agent tokens are used automatically):
   ```bash
   cp .env.example .env
   ```

3. **Start the Web Dashboard & Express Backend** (port `3000`):
   ```bash
   npm run dev
   ```

4. **Start the Local Chrome Agent on your PC** (separate terminal, bound to `127.0.0.1:47120`):
   ```bash
   npm run agent
   ```

5. Open `http://localhost:3000` in your browser, authorize a domain you own under **Authorized Domains**, confirm ownership, and run a QA session.

---

## Production Build & Startup

1. **Type-check & build static frontend assets (`dist/`)**:
   ```bash
   npm run lint
   npm run build
   ```

2. **Run production server** (serves `dist/` and API routes from Express on `PORT=3000`):
   ```bash
   npm start
   ```

3. **Run the Local Chrome Agent** on the workstation where Chrome windows should launch:
   ```bash
   npm run agent
   ```

---

## Environment Variables (`.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Express HTTP server port |
| `AGENT_HOST` | `127.0.0.1` | Local agent bind address (enforced `127.0.0.1` only) |
| `AGENT_PORT` | `47120` | Local agent HTTP port |
| `SQLITE_DB_PATH` | `./data/browser-tester.db` | SQLite database file path |
| `AGENT_AUTH_TOKEN` | Auto-generated in `data/.agent-token` | Shared secret token (`X-Agent-Token`) between Express and local agent |
| `ALLOW_LOCAL_DEV_TARGETS` | `false` | Allows `localhost` / `127.0.0.1` QA targets when `true` (can also be toggled in UI Settings) |
| `CHROME_EXECUTABLE_PATH` | Auto-detected | Optional explicit path to Chrome binary |
| `DASHBOARD_CALLBACK_URL` | `http://127.0.0.1:3000` | Loopback callback URL used by local agent to post QA progress |

---

## Manual Testing

Please follow [MANUAL_TESTING_GUIDE.md](./MANUAL_TESTING_GUIDE.md) on your PC with Google Chrome installed to verify all interactive browser flows, Chrome launch modes, scroll behavior, video checks, and error states.
