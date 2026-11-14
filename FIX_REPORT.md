# Browser Tester preparation report

## Included in this package

- Corrected the Vite 8 / esbuild peer-version range (`esbuild: ^0.28.2`).
- Added `cross-env` for the production start script on Windows.
- Included Windows start/stop batch files and clear manual PowerShell commands.
- Added `.env.example` with local-safe defaults and removed unrelated AI Studio placeholders.
- Changed the dashboard server to bind to `127.0.0.1` by default; public binding requires explicit production `HOST=0.0.0.0`. The Chrome Agent remains strictly on `127.0.0.1`.
- Added a GitHub Actions workflow for TypeScript and production-build checks.
- Updated the README and deployment instructions.
- Added a single-window Manual Preview button for user-controlled viewing of HTTP(S) links; it does not autoplay, loop, refresh, or create multiple copies.
- Extended the automated-playback block to YouTube, Instagram, Facebook, and TikTok; kept ad-interaction, private-target, and artificial-engagement protections.

## Verification status

- Inspected the uploaded project ZIP and its startup, package, server, and validation files.
- Parsed `package.json` and checked the project scripts/configuration.
- Attempted `npm install` in the build environment, but dependency installation did not complete before the environment timeout. Therefore `npm run lint`, `npm run build`, and a real Chrome launch have **not** been verified here.

Run the Windows launcher on your PC. If installation fails, send the complete error from the backend terminal.
