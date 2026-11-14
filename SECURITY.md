# Security Architecture & Hardening (`SECURITY.md`)

Browser Tester is designed around strict authorization, process isolation, SSRF prevention, and zero personal browser data exposure.

---

## 1. Local Chrome Agent Isolation & Authentication
- **Loopback-Only Binding**: `server/config.ts` and `server/localAgentInterface.ts` enforce `AGENT_HOST === '127.0.0.1'`. Any non-loopback configuration throws a startup policy violation.
- **Shared-Secret Authentication**: Communication between the Express backend (`server.ts`) and the local Chrome agent (`127.0.0.1:47120`) requires a 256-bit `X-Agent-Token` (`AGENT_AUTH_TOKEN` or auto-generated `data/.agent-token` with `0o600` file permissions). Verification uses SHA-256 digests compared via `crypto.timingSafeEqual`.
- **No Frontend Token Exposure**: `X-Agent-Token` is strictly server-to-agent and is never sent to or stored in browser JavaScript (`VITE_*`).
- **Anti-CSRF & Anti-DNS-Rebinding on Local Agent**:
  - Any request to `127.0.0.1:47120` containing a browser `Origin` header is rejected with `403`.
  - Requests must carry a valid `Host` header (`127.0.0.1:<port>` or `localhost:<port>`).
  - Non-loopback remote socket addresses are rejected with `403`.

## 2. Domain Ownership & Acceptable QA Policy
- **Explicit Allowlist**: `POST /api/tests` and `POST /api/tests/:id/retry` verify that the target URL's hostname matches an entry in the SQLite `authorized_domains` table and that the operator explicitly confirmed authorization.
- **Prohibited Platforms & Abuse Vectors**:
  - YouTube and third-party engagement-manipulation domains (`youtube.com`, `youtu.be`, `youtube-nocookie.com`) are rejected by both input validation and URL checks.
  - Known advertising networks (`doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, `adnxs.com`, `taboola.com`, `outbrain.com`, etc.) are blocked during domain validation and aborted at the Playwright network layer (`context.route`).
  - Abuse-oriented query/path keywords (`viewbot`, `fake-views`, `buy-views`, `ad-click`, `clickfarm`, `auto_subscribe`) are blocked.

## 3. SSRF & Redirect Protection
- **Scheme & Credential Blocking**: Only `http://` and `https://` URLs are permitted; URLs with embedded `username:password@` credentials or >2048 characters are rejected.
- **Private IP & Cloud Metadata Blocking**:
  - Link-local / cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`, `metadata.goog`, `0.0.0.0`, `::`) and RFC1918 / CGNAT / ULA ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `fe80::/10`, `fc00::/7`) are blocked.
  - Loopback targets (`localhost`, `127.0.0.1`, `::1`) are blocked by default and permitted only when **Local Development Mode** (`allowLocalDevTargets`) is explicitly enabled—even then, requests to the local Chrome agent port (`47120`) are always aborted.
- **DNS Lookup & Redirect-Hop Enforcement**:
  - `verifyUrlDnsSafety()` resolves hostnames before test creation, domain addition, and session start to ensure domains do not resolve to restricted/private IPs.
  - Inside Playwright (`server/playwrightManager.ts`), `attachPolicyGuards` intercepts all requests (`**/*`), blocking non-HTTP(S) navigation schemes, ad hosts, private IP literals, the agent port, and performing DNS safety verification on redirect navigation hops.

## 4. Chrome Profile Isolation & Cleanup
- **Zero Personal Profile Access**: Browser Tester never reads the user's default Chrome User Data directory, saved passwords, extensions, bookmarks, or personal cookies.
- **Ephemeral Sessions**:
  - **Normal Mode** uses a freshly created unique OS temp directory (`os.tmpdir()/bt-normal-<sessionId>-<instanceIndex>-*`) via `chromium.launchPersistentContext` with `--no-first-run`, `--no-default-browser-check`, `--disable-sync`, `--disable-extensions`, and `acceptDownloads: false`.
  - **Incognito Mode** launches a fresh browser with `--incognito` and an isolated `browser.newContext({ acceptDownloads: false })`.
- **Automatic Cleanup**: Temp profile directories and contexts are cleaned up on test completion, timeout, user stop, external browser/tab closure (`browser.on('disconnected')`, `context.on('close')`, `page.on('close')`), and agent process shutdown (`SIGINT`/`SIGTERM`).

## 5. API Hardening & Safe Error Handling
- Express disables `x-powered-by` and sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- JSON payloads are bounded (`128kb` on Express, `64kb` on the local agent).
- Sliding-window rate limiting protects test launch/retry endpoints (30 requests/min), domain/settings mutations (60 requests/min), and the local agent (120 requests/min).
- Production error middleware (`NODE_ENV=production`) masks raw stack/internal error details behind generic error messages.
