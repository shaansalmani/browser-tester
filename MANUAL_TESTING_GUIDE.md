# Browser Tester — Manual Testing Guide

This guide walks you through verifying **Browser Tester** end-to-end on your local machine with Google Chrome installed.

---

## Before You Begin

1. Confirm **Google Chrome** is installed on your machine.
2. Start the web server (development or production):
   - Development: `npm run dev`
   - Production: `npm run build && npm start`
3. Start the local Chrome agent in a second terminal on the **same PC**:
   ```bash
   npm run agent
   ```
   Verify the console prints:
   - `[Browser Tester Local Chrome Agent] Listening strictly on http://127.0.0.1:47120`
   - `[Browser Tester Local Chrome Agent] Google Chrome detected at: ...`
4. Open `http://localhost:3000`.

---

## Test Checklist

### 1. Local Agent Connectivity & Chrome Detection
- Scroll to the **Local Chrome Agent** panel on the dashboard.
- Verify **Agent Connection** shows `Connected & Authenticated` and **Google Chrome** shows `Installed` alongside the detected binary path.
- **Offline check**: Temporarily stop the agent (`Ctrl+C` in the agent terminal) and click **Check**. Verify the dashboard displays `Offline (run npm run agent)` and warns before clicking **Generate**. Restart `npm run agent`.

### 2. URL Validation & Authorized Domain Enforcement
- Enter an invalid string (e.g., `not-a-url` or `ftp://example.com`) in **Target URL**. Verify inline validation blocks submission.
- Enter a blocked platform URL (e.g., `https://www.youtube.com/watch?v=dQw4w9WgXcQ`) or ad domain (`https://doubleclick.net`). Verify it is rejected by policy.
- Enter a cloud metadata / private IP (e.g., `http://169.254.169.254` or `http://192.168.1.1`). Verify it is blocked.
- Enter an authorized domain you own (e.g., `https://example.com` or your staging site) that is not yet in **Authorized Domains**. Verify the inline warning appears with an **Authorize ...** quick action, and verify **Generate** fails unless the domain is authorized and the ownership checkbox is checked.
- Authorize the domain under **Authorized Domains** (checking `"I own or hold authorization for this domain"`). Confirm it persists across page reloads.

### 3. Chrome Normal Mode Execution
- Select **Website Test**, enter your authorized URL, set **Quantity** to `1`, **Mode** to **Normal**, check ownership confirmation, and click **Generate**.
- Verify a real Google Chrome window opens using a fresh temporary profile (no personal bookmarks, extensions, saved passwords, or personal cookies).
- Confirm the window navigates to your target URL, stays visible during the QA check, and closes automatically when finished.

### 4. Chrome Incognito Mode Execution
- Set **Mode** to **Incognito**, **Quantity** to `1`, and click **Generate**.
- Verify Chrome launches an isolated Incognito browser context (`--incognito` + ephemeral Playwright context) without accessing personal Chrome data, runs the test, and closes cleanly.

### 5. Website QA Page Load & Metadata Extraction
- After a **Website Test** finishes, click **Details** in **Test History** and then **Report** to open the **Test Reports** page.
- Verify the report accurately displays:
  - **Session ID** (e.g., `bt-1-1`)
  - **Page Title** & **Final URL**
  - **Page-Load Status**, HTTP status code (e.g., `HTTP 200`), and **load duration (ms)**
  - **Start Time** and **End Time**

### 6. Controlled Gradual Scrolling & Lazy-Load Detection
- Configure **QA Scroll & Timeout Parameters** (e.g., interval `600ms`, distance `500px`, max scrolls `15`, stale checks `3`, max duration `45s`) and run a **Website Test** on a long or lazy-loading authorized page.
- Observe the **Live Session & Scroll Progress** panel updating step counts (`Scroll X/15`) and percentage in real time.
- Verify the finished report shows:
  - **Scroll Status** (`reached_bottom`, `no_new_content`, or `max_scrolls_reached`)
  - **Initial height → Final height** in pixels
  - Whether **Lazy-load detected** triggered when page height or content count grew.

### 7. Infinite-Scroll & Max Duration Protection
- Set **Max Duration (sec)** to `8` and **Max Scrolls** to `60` on a very long or infinitely scrolling authorized page.
- Verify the session stops automatically when the 8-second cap is reached, closes the Chrome window, and records `timed_out` cleanly without hanging.

### 8. Video Playback QA Test
- Select **Video Playback Test**, enter an authorized page URL containing an HTML5 `<video>` element (or test a page with none), and click **Generate**.
- Verify the report records whether the video player is visible (`Yes`/`No`), its playback status (`playing_verified`, `autoplay_blocked_manual_required`, `no_video_found`, or `player_error`), and any player error message.

### 9. Stop Controls (Individual Window, Session, and Stop All)
- Start a session with **Quantity** `2` and a longer duration (`30s`).
- While Chrome windows are open in **Live Session & Scroll Progress**:
  - Click **Stop** on one individual instance (`bt-X-1`) -> verify that window closes immediately while the second continues.
  - Start another multi-instance run and click **Stop Session** or **Stop All Sessions** -> verify all open Chrome windows close and statuses update to `stopped`.

### 10. Failed Session Retry & Bounded Retries
- Trigger a failed or timed-out session (for example, an authorized domain returning HTTP 404/500 or a 5s timeout).
- Click **Retry** on the failed session (from **Test History**, **Configure QA Test**, or **Test Reports**).
- Verify a new linked retry session (`Retry #1 of #X`) runs cleanly, and verify retrying stops being offered after 3 retry attempts.

### 11. Concurrency Limit Enforcement
- Under **Concurrency & Security Settings**, set **Max Concurrent** to `2` and **Max Per Session** to `2`, and click **Save Settings**.
- Verify attempting to launch `3` instances—or launching a second session while `2` instances are actively running—is rejected with a clear concurrency limit error.

### 12. Dark/Light Theme & Responsive Layout
- Click **Dark** / **Light** in the top navigation bar and refresh the page to verify theme persistence.
- Resize the browser window to mobile (`~375px`), tablet (`~768px`), and desktop (`1280px+`) widths. Confirm no horizontal overflow, clipped buttons, or overlapping panels occur.
- Navigate between **Dashboard** and **Test Reports** and back.

### 13. SQLite Persistence & History Management
- Reload the browser (`F5`) and restart `npm run dev` / `npm start`—verify sessions, reports, authorized domains, and concurrency settings remain intact in SQLite (`./data/browser-tester.db`).
- Test search/status filters in **Test History**, single session deletion, and **Clear History** (confirm dialog clears finished sessions while preserving active ones).

---

## Troubleshooting

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `Local Chrome agent is offline (127.0.0.1:47120)` | Companion agent is not running on your PC | Run `npm run agent` in a separate terminal on the same machine. |
| `Google Chrome binary was not found` | Chrome is installed in a non-standard directory | Install Google Chrome or set `CHROME_EXECUTABLE_PATH=/path/to/chrome` in `.env` and restart `npm run agent`. |
| `Local agent rejected backend authentication token (401)` | `AGENT_AUTH_TOKEN` differs between backend and agent processes | Ensure both `server.ts` and `standaloneAgent.ts` share the same `data/.agent-token` file or matching `AGENT_AUTH_TOKEN` in `.env`. |
| `Localhost and private IPs are blocked` | Target uses `localhost` or `127.0.0.1` while disabled | Enable **Allow localhost / 127.0.0.1 targets for local development** in **Concurrency & Security Settings**, then authorize `localhost` or `127.0.0.1`. |
| Temporary profile directories after crash | OS process killed with `SIGKILL` | Temporary folders matching `bt-normal-*` in your OS temp directory can be safely deleted; normal exits/stops auto-clean them. |
