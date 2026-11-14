import 'dotenv/config';
import { detectGoogleChrome } from './chromeDetector.ts';
import { AGENT_HOST, AGENT_PORT, getAgentAuthToken } from './config.ts';
import { createLocalAgentServer } from './localAgentInterface.ts';

getAgentAuthToken();
const chrome = detectGoogleChrome();
const { server, manager } = createLocalAgentServer();

server.listen(AGENT_PORT, AGENT_HOST, () => {
  console.log(
    `[Browser Tester Local Chrome Agent] Listening strictly on http://${AGENT_HOST}:${AGENT_PORT}`
  );
  if (chrome.installed) {
    console.log(
      `[Browser Tester Local Chrome Agent] Google Chrome detected at: ${chrome.executablePath}`
    );
  } else {
    console.warn(`[Browser Tester Local Chrome Agent] WARNING: ${chrome.error}`);
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Browser Tester Local Chrome Agent] Received ${signal}, closing active Chrome sessions...`);
  await manager.stopAll('Local Chrome agent process stopped');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
