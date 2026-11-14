# Deployment guide

## GitHub

1. Create an empty GitHub repository or use your existing repository.
2. Keep `.env.example`; do not commit `.env`, `node_modules/`, `dist/`, or `data/`.
3. From the project folder run `git status`, `git add .`, `git commit -m "Prepare Browser Tester"`, then `git push`.
4. GitHub stores the source; it does not run the local Node backend or launch Chrome.

## Render (dashboard/API only)

`render.yaml` provides a starting Blueprint. Review the plan, persistent disk pricing, and public-service security before deploying. The hosted service cannot access a Chrome Agent running on your PC because the current agent protocol is loopback-only. Consequently, a Render deployment is not a substitute for running the Windows launcher when you need local Chrome testing.

Do not open port 47120 to the internet. A cloud-to-local bridge would require a separately designed authenticated outbound connection.
