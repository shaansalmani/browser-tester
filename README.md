# Browser Tester

Browser Tester is a local-first website QA dashboard with an isolated Chrome companion agent. Use it only on websites you own or are explicitly authorized to test. It is not a traffic generator and must not be used to create artificial views, watch time, ad impressions/clicks, or social engagement.

## Requirements (Windows)

- Windows 10/11 (64-bit)
- Node.js 20.19+ (recommended: Node.js 22 LTS) and npm 10+
- Google Chrome installed
- Internet connection for the first dependency installation

## Easiest way to run

1. Extract the ZIP into a normal folder (do not run it from inside the ZIP).
2. Double-click **Start Browser Tester.bat**.
3. On first launch, it installs dependencies, starts the dashboard/backend, waits for its health check, starts the local Chrome Agent, and opens `http://127.0.0.1:3000`.
4. Keep the two terminal windows open while using Browser Tester.
5. To stop the app, press `Ctrl+C` in both terminal windows. You can also use **Stop Browser Tester.bat** for the instructions.

Do not double-click `index.html`: it is only the frontend entry point and cannot start the Node.js backend.

## Manual start (PowerShell)

Open PowerShell in the extracted project folder and run:

```powershell
npm.cmd install
npm.cmd run dev
```

Open a second PowerShell window in the same folder and run:

```powershell
npm.cmd run agent
```

Then open `http://127.0.0.1:3000`. Using `npm.cmd` avoids the common PowerShell `npm.ps1` execution-policy error.

If you prefer to use `npm` rather than `npm.cmd` and PowerShell blocks scripts, you can allow locally installed scripts for your Windows user with:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Build checks

```powershell
npm.cmd install
npm.cmd run lint
npm.cmd run build
```

To serve the production build locally, set production mode and start the server:

```powershell
$env:NODE_ENV = 'production'
npm.cmd start
```

## GitHub upload

GitHub stores the source code; it does not run the local backend or launch Chrome. Before pushing, make sure `.env`, `node_modules`, `dist`, and `data/` are not staged. They are excluded by `.gitignore`. Keep `.env.example` in the repository. This source package does not include an npm lockfile because package-registry access was unavailable during preparation; after the first successful `npm.cmd install` on your PC, keep the generated `package-lock.json` and commit it to GitHub for repeatable installs.

The ZIP intentionally does not contain a `.git` folder. To update your existing GitHub repository, first clone it (or use your existing cloned working folder), then copy/overwrite these extracted project files into that clone **without deleting its `.git` folder**. In the cloned folder, run:

```powershell
git status
git add .
git commit -m "Prepare Browser Tester for local Windows use"
git push origin main
```

For a brand-new GitHub repository, create an empty repository on GitHub, then run `git init`, `git add .`, `git commit -m "Initial Browser Tester commit"`, `git branch -M main`, `git remote add origin YOUR_REPOSITORY_URL`, and `git push -u origin main`.

## Security and supported testing

- Add only domains you own or have written permission to test.
- Automated tests are for authorized website QA, including page loading and scrolling.
- **Manual Preview** opens one small popup window for a user-supplied HTTP(S) link. You control playback yourself; it does not autoplay, loop, refresh, or open multiple copies.
- YouTube, Instagram, Facebook, TikTok, and other third-party social/video platforms remain blocked from automated playback testing.
- Ad networks, private IP ranges, cloud metadata endpoints, and engagement-manipulation targets remain blocked.
- The dashboard defaults to `127.0.0.1`; the Chrome Agent binds strictly to `127.0.0.1:47120`. Do not expose the agent port publicly.
- Keep `.env`, `data/`, database files, authentication tokens, and personal browser profiles private.

## Cloud hosting limitation

`render.yaml` is included as a deployment template for the dashboard/API only. The Chrome Agent is intentionally loopback-only, so a cloud-hosted backend cannot launch Chrome on your personal PC. A secure outbound agent-to-cloud bridge is not included. For actual Chrome testing on your Windows PC, run the app locally with the Windows launcher.
