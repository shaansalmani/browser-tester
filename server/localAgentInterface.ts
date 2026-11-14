import http from 'node:http';
import type {
  AgentActiveInstance,
  AgentCommandContract,
  AgentInterfaceStatus,
  ChromeDetectionStatus,
  TestStatus,
} from '../src/types/testing.ts';
import { detectGoogleChrome } from './chromeDetector.ts';
import {
  AGENT_HOST,
  AGENT_PORT,
  DEFAULT_QA_SCROLL_CONFIG,
  getAgentAuthToken,
  getDashboardCallbackBaseUrl,
  verifyAgentAuthToken,
} from './config.ts';
import { PlaywrightChromeManager } from './playwrightManager.ts';
import {
  validateAuthorizedTestUrl,
  validateQaScrollConfig,
  verifyUrlDnsSafety,
} from './validation.ts';

function assertLoopbackHost(host: string): void {
  if (host !== '127.0.0.1') {
    throw new Error(`Refusing non-loopback agent host "${host}". Must be 127.0.0.1.`);
  }
}

export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

const PHASE_3_SECURITY_POLICY = {
  isolatedProfilesOnly: true,
  personalProfileAccess: false,
  adInteractionBlocked: true,
  artificialEngagementBlocked: true,
};

function readJsonBody(req: http.IncomingMessage, maxBytes = 65536): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    let body = '';

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function createLocalAgentServer(): {
  server: http.Server;
  manager: PlaywrightChromeManager;
} {
  assertLoopbackHost(AGENT_HOST);
  getAgentAuthToken();
  const callbackBaseUrl = getDashboardCallbackBaseUrl();

  const requestTimestamps: number[] = [];
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 120;

  const manager = new PlaywrightChromeManager(async (update) => {
    try {
      const token = getAgentAuthToken();
      await fetch(`${callbackBaseUrl}/api/agent/sessions/${update.sessionId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Token': token,
        },
        body: JSON.stringify({
          results: [
            {
              instanceIndex: update.instanceIndex,
              status: update.status,
              httpStatus: update.httpStatus ?? null,
              loadTimeMs: update.loadTimeMs ?? null,
              finalUrl: update.finalUrl ?? null,
              pageTitle: update.pageTitle ?? null,
              pageLoadStatus: update.pageLoadStatus,
              scrollStatus: update.scrollStatus,
              scrollSteps: update.scrollSteps,
              maxScrollSteps: update.maxScrollSteps,
              scrollProgressPct: update.scrollProgressPct,
              initialHeight: update.initialHeight ?? null,
              finalHeight: update.finalHeight ?? null,
              heightChanges: update.heightChanges,
              lazyLoadedDetected: update.lazyLoadedDetected,
              videoVisible: update.videoVisible ?? null,
              videoPlaybackStatus: update.videoPlaybackStatus,
              videoError: update.videoError ?? null,
              message: update.message ?? null,
            },
          ],
          errorMessage:
            update.status === 'failed' || update.status === 'timed_out'
              ? (update.message ?? null)
              : null,
        }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Dashboard callback may be temporarily unavailable
    }
  });

  const server = http.createServer(async (req, res) => {
    if (!isLoopbackRemoteAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, { error: 'Loopback access only (127.0.0.1).' });
      return;
    }

    // Never allow cross-origin browser scripts to interact with the local agent
    if (req.headers.origin) {
      sendJson(res, 403, { error: 'Browser cross-origin access to local agent is prohibited.' });
      return;
    }

    // Prevent DNS rebinding via Host header validation
    const hostHeader = (req.headers.host || '').toLowerCase();
    const validHosts = new Set([`127.0.0.1:${AGENT_PORT}`, `localhost:${AGENT_PORT}`]);
    if (!validHosts.has(hostHeader)) {
      sendJson(res, 403, { error: 'Invalid Host header for local agent.' });
      return;
    }

    const nowMs = Date.now();
    while (requestTimestamps.length > 0 && nowMs - requestTimestamps[0] > RATE_LIMIT_WINDOW_MS) {
      requestTimestamps.shift();
    }
    if (requestTimestamps.length >= RATE_LIMIT_MAX) {
      sendJson(res, 429, { error: 'Local agent rate limit exceeded.' });
      return;
    }
    requestTimestamps.push(nowMs);

    const tokenHeader = req.headers['x-agent-token'];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!verifyAgentAuthToken(token)) {
      sendJson(res, 401, { error: 'Unauthorized: invalid or missing X-Agent-Token.' });
      return;
    }

    const urlPath = (req.url || '').split('?')[0];

    if (req.method === 'GET' && urlPath === '/agent/health') {
      const chrome = detectGoogleChrome();
      sendJson(res, 200, {
        status: 'ready',
        phase: '4/4',
        bindAddress: AGENT_HOST,
        port: AGENT_PORT,
        authenticated: true,
        engine: 'playwright-chrome',
        chrome,
        activeInstancesCount: manager.getActiveCount(),
        activeInstances: manager.getActiveInstances(),
        securityPolicy: PHASE_3_SECURITY_POLICY,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/agent/sessions/start') {
      try {
        const body = (await readJsonBody(req)) as Partial<AgentCommandContract> & {
          allowLocalDevTargets?: boolean;
        };

        if (
          body.browser !== 'Chrome' ||
          typeof body.sessionId !== 'number' ||
          !Number.isInteger(body.sessionId) ||
          typeof body.url !== 'string' ||
          typeof body.quantity !== 'number' ||
          !Number.isInteger(body.quantity) ||
          body.quantity < 1 ||
          body.quantity > 5 ||
          (body.mode !== 'Normal' && body.mode !== 'Incognito') ||
          (body.testType !== 'Website Test' && body.testType !== 'Video Playback Test')
        ) {
          sendJson(res, 400, { error: 'Invalid session start payload.' });
          return;
        }

        const qaCheck = validateQaScrollConfig(body.qaConfig);
        const qaConfig = qaCheck.valid ? qaCheck.config : { ...DEFAULT_QA_SCROLL_CONFIG };

        const allowLocal = Boolean(body.allowLocalDevTargets);
        const urlCheck = validateAuthorizedTestUrl(body.url, {
          requireAllowlist: false,
          allowLocalDevTargets: allowLocal,
        });
        if (!urlCheck.valid) {
          sendJson(res, urlCheck.statusCode, { error: urlCheck.error });
          return;
        }

        const dnsCheck = await verifyUrlDnsSafety(urlCheck.hostname, allowLocal);
        if (!dnsCheck.safe) {
          sendJson(res, 403, { error: dnsCheck.error });
          return;
        }

        const chrome = detectGoogleChrome();
        if (!chrome.installed) {
          sendJson(res, 503, {
            error: chrome.error || 'Google Chrome is not installed on this PC.',
            chrome,
          });
          return;
        }

        const result = await manager.launchSession({
          sessionId: body.sessionId,
          testType: body.testType,
          url: urlCheck.url,
          quantity: body.quantity,
          mode: body.mode,
          qaConfig,
          allowLocalDevTargets: allowLocal,
        });

        sendJson(res, result.launched.length > 0 ? 202 : 500, {
          accepted: result.launched.length > 0,
          sessionId: body.sessionId,
          launched: result.launched,
          failedInstances: result.failedInstances,
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
          sendJson(res, 413, { error: 'Payload too large.' });
          return;
        }
        if (err instanceof Error && err.message === 'INVALID_JSON') {
          sendJson(res, 400, { error: 'Malformed JSON payload.' });
          return;
        }
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : 'Failed to launch Chrome session.',
        });
      }
      return;
    }

    const stopSessionMatch = urlPath.match(/^\/agent\/sessions\/(\d+)\/stop$/);
    if (req.method === 'POST' && stopSessionMatch) {
      const sessionId = Number(stopSessionMatch[1]);
      const stoppedCount = await manager.stopSession(sessionId, 'Stopped from Browser Tester');
      sendJson(res, 200, { stopped: true, sessionId, stoppedCount });
      return;
    }

    const stopInstanceMatch = urlPath.match(/^\/agent\/instances\/(bt-\d+-\d+)\/stop$/);
    if (req.method === 'POST' && stopInstanceMatch) {
      const instanceUid = stopInstanceMatch[1];
      const stopped = await manager.stopInstance(
        instanceUid,
        'Instance stopped from Browser Tester'
      );
      sendJson(res, stopped ? 200 : 404, {
        stopped,
        instanceUid,
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/agent/stop-all') {
      const stoppedCount = await manager.stopAll('All sessions stopped from Browser Tester');
      sendJson(res, 200, { stopped: true, stoppedCount });
      return;
    }

    sendJson(res, 404, { error: 'Not found on 127.0.0.1 local Chrome agent.' });
  });

  return { server, manager };
}

function defaultUnavailableChrome(checkedAt: string, error: string): ChromeDetectionStatus {
  return {
    installed: false,
    executablePath: null,
    detectionMethod: 'agent-offline',
    checkedAt,
    error,
  };
}

export async function checkAgentInterface(): Promise<AgentInterfaceStatus> {
  assertLoopbackHost(AGENT_HOST);
  const checkedAt = new Date().toISOString();

  try {
    const token = getAgentAuthToken();
    const response = await fetch(`http://${AGENT_HOST}:${AGENT_PORT}/agent/health`, {
      method: 'GET',
      headers: {
        'X-Agent-Token': token,
      },
      signal: AbortSignal.timeout(1500),
    });

    if (response.status === 401) {
      return {
        bindHost: AGENT_HOST,
        port: AGENT_PORT,
        reachable: true,
        authenticated: false,
        phase: '4/4',
        engine: 'playwright-chrome',
        chrome: defaultUnavailableChrome(checkedAt, 'Agent authentication token mismatch.'),
        activeInstancesCount: 0,
        activeInstances: [],
        securityPolicy: PHASE_3_SECURITY_POLICY,
        checkedAt,
        error: 'Local agent rejected backend authentication token (401).',
      };
    }

    if (!response.ok) {
      return {
        bindHost: AGENT_HOST,
        port: AGENT_PORT,
        reachable: false,
        authenticated: false,
        phase: '4/4',
        engine: 'unavailable',
        chrome: defaultUnavailableChrome(checkedAt, `Agent returned HTTP ${response.status}`),
        activeInstancesCount: 0,
        activeInstances: [],
        securityPolicy: PHASE_3_SECURITY_POLICY,
        checkedAt,
        error: `Agent health returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      phase?: string;
      engine?: string;
      authenticated?: boolean;
      chrome?: ChromeDetectionStatus;
      activeInstancesCount?: number;
      activeInstances?: AgentActiveInstance[];
      securityPolicy?: typeof PHASE_3_SECURITY_POLICY;
    };

    return {
      bindHost: AGENT_HOST,
      port: AGENT_PORT,
      reachable: true,
      authenticated: Boolean(data.authenticated),
      phase: data.phase ?? '3/4',
      engine: data.engine ?? 'playwright-chrome',
      chrome:
        data.chrome ??
        defaultUnavailableChrome(checkedAt, 'Agent did not return Chrome detection data.'),
      activeInstancesCount: data.activeInstancesCount ?? 0,
      activeInstances: data.activeInstances ?? [],
      securityPolicy: data.securityPolicy ?? PHASE_3_SECURITY_POLICY,
      checkedAt,
    };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Unable to reach 127.0.0.1 local Chrome agent';
    return {
      bindHost: AGENT_HOST,
      port: AGENT_PORT,
      reachable: false,
      authenticated: false,
      phase: '4/4',
      engine: 'disconnected',
      chrome: defaultUnavailableChrome(
        checkedAt,
        'Local agent offline. Start it on your PC with: npm run agent'
      ),
      activeInstancesCount: 0,
      activeInstances: [],
      securityPolicy: PHASE_3_SECURITY_POLICY,
      checkedAt,
      error: `Local Chrome agent is not running on ${AGENT_HOST}:${AGENT_PORT} (${msg}).`,
    };
  }
}

export async function dispatchSessionStartToAgent(
  contract: AgentCommandContract,
  allowLocalDevTargets: boolean
): Promise<{
  accepted: boolean;
  statusCode: number;
  launched: AgentActiveInstance[];
  failedInstances: Array<{ instanceIndex: number; error: string }>;
  error?: string;
}> {
  assertLoopbackHost(AGENT_HOST);
  const token = getAgentAuthToken();

  try {
    const response = await fetch(`http://${AGENT_HOST}:${AGENT_PORT}/agent/sessions/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Token': token,
      },
      body: JSON.stringify({
        ...contract,
        allowLocalDevTargets,
      }),
      signal: AbortSignal.timeout(45000),
    });

    const data = (await response.json().catch(() => ({}))) as {
      accepted?: boolean;
      launched?: AgentActiveInstance[];
      failedInstances?: Array<{ instanceIndex: number; error: string }>;
      error?: string;
    };

    return {
      accepted: response.ok && Boolean(data.accepted),
      statusCode: response.status,
      launched: data.launched ?? [],
      failedInstances: data.failedInstances ?? [],
      error: data.error,
    };
  } catch (err) {
    return {
      accepted: false,
      statusCode: 503,
      launched: [],
      failedInstances: [],
      error:
        err instanceof Error
          ? `Local Chrome agent unreachable on 127.0.0.1:${AGENT_PORT} (${err.message})`
          : 'Local Chrome agent unreachable.',
    };
  }
}

export async function stopAgentSession(sessionId: number): Promise<{
  reachable: boolean;
  stoppedCount: number;
  error?: string;
}> {
  assertLoopbackHost(AGENT_HOST);
  const token = getAgentAuthToken();

  try {
    const response = await fetch(
      `http://${AGENT_HOST}:${AGENT_PORT}/agent/sessions/${sessionId}/stop`,
      {
        method: 'POST',
        headers: {
          'X-Agent-Token': token,
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    const data = (await response.json().catch(() => ({}))) as {
      stoppedCount?: number;
      error?: string;
    };

    if (!response.ok) {
      return {
        reachable: true,
        stoppedCount: 0,
        error: data.error || `Agent returned HTTP ${response.status}`,
      };
    }

    return {
      reachable: true,
      stoppedCount: data.stoppedCount ?? 0,
    };
  } catch (err) {
    return {
      reachable: false,
      stoppedCount: 0,
      error: err instanceof Error ? err.message : 'Local agent unreachable',
    };
  }
}

export async function stopAgentInstance(instanceUid: string): Promise<{
  reachable: boolean;
  stopped: boolean;
  error?: string;
}> {
  assertLoopbackHost(AGENT_HOST);
  const token = getAgentAuthToken();

  try {
    const response = await fetch(
      `http://${AGENT_HOST}:${AGENT_PORT}/agent/instances/${encodeURIComponent(instanceUid)}/stop`,
      {
        method: 'POST',
        headers: {
          'X-Agent-Token': token,
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    const data = (await response.json().catch(() => ({}))) as {
      stopped?: boolean;
      error?: string;
    };

    return {
      reachable: true,
      stopped: response.ok && Boolean(data.stopped),
      error: data.error,
    };
  } catch (err) {
    return {
      reachable: false,
      stopped: false,
      error: err instanceof Error ? err.message : 'Local agent unreachable',
    };
  }
}

export async function stopAllAgentSessions(): Promise<{
  reachable: boolean;
  stoppedCount: number;
  error?: string;
}> {
  assertLoopbackHost(AGENT_HOST);
  const token = getAgentAuthToken();

  try {
    const response = await fetch(`http://${AGENT_HOST}:${AGENT_PORT}/agent/stop-all`, {
      method: 'POST',
      headers: {
        'X-Agent-Token': token,
      },
      signal: AbortSignal.timeout(15000),
    });

    const data = (await response.json().catch(() => ({}))) as {
      stoppedCount?: number;
      error?: string;
    };

    if (!response.ok) {
      return {
        reachable: true,
        stoppedCount: 0,
        error: data.error || `Agent returned HTTP ${response.status}`,
      };
    }

    return {
      reachable: true,
      stoppedCount: data.stoppedCount ?? 0,
    };
  } catch (err) {
    return {
      reachable: false,
      stoppedCount: 0,
      error: err instanceof Error ? err.message : 'Local agent unreachable',
    };
  }
}

export type { TestStatus };
