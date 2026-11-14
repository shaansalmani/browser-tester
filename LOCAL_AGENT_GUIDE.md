# Local Chrome Agent guide

For local QA, run `Start Browser Tester.bat`. It starts the dashboard backend first, waits for `/api/health`, then starts the Chrome Agent. The agent binds only to `127.0.0.1:47120`; keep this restriction.

If the dashboard reports the agent offline:
- Check that the Agent terminal window is still open.
- Confirm Google Chrome is installed.
- Check whether port 47120 is already occupied.
- Keep the backend and agent using the same project folder and `data/.agent-token`.

Do not expose port 47120 publicly. Hosted dashboards cannot connect to this local-only agent in the current architecture.
