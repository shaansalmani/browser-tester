import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import type { HealthResponse } from './src/types/testing.ts';
import {
  AGENT_HOST,
  AGENT_PORT,
  ALLOWED_BROWSER,
  HARD_MAX_ACTIVE_INSTANCES,
  HARD_MAX_QUANTITY_PER_SESSION,
  MAX_RETRY_ATTEMPTS,
  SERVER_PORT,
  getAgentAuthToken,
  verifyAgentAuthToken,
} from './server/config.ts';
import {
  addAuthorizedDomain,
  checkDatabaseHealth,
  clearFinishedHistory,
  createTestSession,
  deleteTestSession,
  getAppSettings,
  getDb,
  getStatusCounts,
  getTestSessionById,
  listAuthorizedDomains,
  listTestSessions,
  markAllActiveSessionsStopped,
  markSessionFailed,
  markSessionStopped,
  reconcileAgentActiveInstances,
  removeAuthorizedDomain,
  updateAppSettings,
  updateSessionFromAgentReport,
  type AgentResultReportItem,
} from './server/db.ts';
import {
  checkAgentInterface,
  dispatchSessionStartToAgent,
  isLoopbackRemoteAddress,
  stopAgentInstance,
  stopAgentSession,
  stopAllAgentSessions,
} from './server/localAgentInterface.ts';
import {
  isValidStatus,
  normalizeDomainInput,
  validateAuthorizedTestUrl,
  validateCreateSessionRequest,
  validateRetryEligibility,
  verifyUrlDnsSafety,
} from './server/validation.ts';

async function startServer(): Promise<void> {
  getDb();
  getAgentAuthToken();

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  const launchTimestamps: number[] = [];
  function checkLaunchRateLimit(res: express.Response): boolean {
    const now = Date.now();
    while (launchTimestamps.length > 0 && now - launchTimestamps[0] > 60_000) {
      launchTimestamps.shift();
    }
    if (launchTimestamps.length >= 30) {
      res.status(429).json({
        error: 'Too many test launch requests. Wait briefly before starting additional sessions.',
      });
      return false;
    }
    launchTimestamps.push(now);
    return true;
  }

  const mutationTimestamps: number[] = [];
  function checkMutationRateLimit(res: express.Response): boolean {
    const now = Date.now();
    while (mutationTimestamps.length > 0 && now - mutationTimestamps[0] > 60_000) {
      mutationTimestamps.shift();
    }
    if (mutationTimestamps.length >= 60) {
      res.status(429).json({
        error: 'Too many configuration requests. Wait briefly before retrying.',
      });
      return false;
    }
    mutationTimestamps.push(now);
    return true;
  }

  app.get('/api/health', async (_req, res) => {
    try {
      const dbHealth = checkDatabaseHealth();
      const agentStatus = await checkAgentInterface();
      if (agentStatus.reachable && agentStatus.authenticated) {
        reconcileAgentActiveInstances(agentStatus.activeInstances.map((i) => i.instanceUid));
      }
      const settings = getAppSettings();

      const payload: HealthResponse = {
        status:
          dbHealth.connected &&
          agentStatus.reachable &&
          agentStatus.authenticated &&
          agentStatus.chrome.installed
            ? 'ok'
            : 'degraded',
        phase: '4/4',
        service: 'browser-tester-api',
        database: {
          connected: dbHealth.connected,
          driver: 'sqlite',
          tables: dbHealth.tables,
        },
        agentInterface: agentStatus,
        limits: {
          allowedBrowser: ALLOWED_BROWSER,
          maxQuantityPerSession: settings.maxQuantityPerSession,
          maxActiveInstances: settings.maxActiveInstances,
          allowLocalDevTargets: settings.allowLocalDevTargets,
          maxRetryAttempts: MAX_RETRY_ATTEMPTS,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(dbHealth.connected ? 200 : 503).json(payload);
    } catch (error) {
      res.status(500).json({
        status: 'degraded',
        error: error instanceof Error ? error.message : 'Health check failed',
      });
    }
  });

  app.get('/api/settings', (_req, res) => {
    const settings = getAppSettings();
    res.json({
      settings,
      bounds: {
        hardMaxQuantityPerSession: HARD_MAX_QUANTITY_PER_SESSION,
        hardMaxActiveInstances: HARD_MAX_ACTIVE_INSTANCES,
      },
    });
  });

  app.put('/api/settings', (req, res) => {
    if (!checkMutationRateLimit(res)) return;
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid settings payload.' });
      return;
    }

    const patch: {
      maxActiveInstances?: number;
      maxQuantityPerSession?: number;
      allowLocalDevTargets?: boolean;
    } = {};

    if (body.maxActiveInstances !== undefined) {
      const val = Number(body.maxActiveInstances);
      if (!Number.isInteger(val) || val < 1 || val > HARD_MAX_ACTIVE_INSTANCES) {
        res.status(400).json({
          error: `Max concurrent instances must be an integer between 1 and ${HARD_MAX_ACTIVE_INSTANCES}.`,
        });
        return;
      }
      patch.maxActiveInstances = val;
    }

    if (body.maxQuantityPerSession !== undefined) {
      const val = Number(body.maxQuantityPerSession);
      if (!Number.isInteger(val) || val < 1 || val > HARD_MAX_QUANTITY_PER_SESSION) {
        res.status(400).json({
          error: `Max quantity per session must be an integer between 1 and ${HARD_MAX_QUANTITY_PER_SESSION}.`,
        });
        return;
      }
      patch.maxQuantityPerSession = val;
    }

    if (body.allowLocalDevTargets !== undefined) {
      if (typeof body.allowLocalDevTargets !== 'boolean') {
        res.status(400).json({ error: 'allowLocalDevTargets must be a boolean.' });
        return;
      }
      patch.allowLocalDevTargets = body.allowLocalDevTargets;
    }

    const updated = updateAppSettings(patch);
    res.json({ settings: updated });
  });

  app.get('/api/domains', (_req, res) => {
    const domains = listAuthorizedDomains();
    res.json({ domains });
  });

  app.post('/api/domains', async (req, res) => {
    if (!checkMutationRateLimit(res)) return;

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body.domain !== 'string') {
      res.status(400).json({ error: 'Domain is required.' });
      return;
    }

    if (body.ownershipConfirmed !== true) {
      res.status(400).json({
        error: 'Ownership or explicit written testing authorization must be confirmed.',
      });
      return;
    }

    const settings = getAppSettings();
    const normalized = normalizeDomainInput(body.domain, settings.allowLocalDevTargets);
    if (!normalized.valid) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    const dnsCheck = await verifyUrlDnsSafety(normalized.domain, settings.allowLocalDevTargets);
    if (!dnsCheck.safe) {
      res.status(403).json({ error: dnsCheck.error });
      return;
    }

    const ownershipNote =
      typeof body.ownershipNote === 'string' && body.ownershipNote.trim().length > 0
        ? body.ownershipNote.trim().slice(0, 160)
        : 'Owner / authorized QA target';

    const authorizedBy =
      typeof body.authorizedBy === 'string' && body.authorizedBy.trim().length > 0
        ? body.authorizedBy.trim().slice(0, 80)
        : 'Workspace Operator';

    const domain = addAuthorizedDomain(normalized.domain, ownershipNote, authorizedBy);
    res.status(201).json({ domain });
  });

  app.delete('/api/domains/:id', (req, res) => {
    if (!checkMutationRateLimit(res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid domain id.' });
      return;
    }

    const removed = removeAuthorizedDomain(id);
    if (!removed) {
      res.status(404).json({ error: 'Authorized domain not found.' });
      return;
    }

    res.json({ deleted: true, id });
  });

  app.get('/api/tests', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.q === 'string' ? req.query.q : undefined;

    const sessions = listTestSessions({ status, search });
    const counts = getStatusCounts();
    const settings = getAppSettings();

    res.json({
      counts,
      sessions,
      limits: {
        allowedBrowser: ALLOWED_BROWSER,
        maxQuantityPerSession: settings.maxQuantityPerSession,
        maxActiveInstances: settings.maxActiveInstances,
        allowLocalDevTargets: settings.allowLocalDevTargets,
        maxRetryAttempts: MAX_RETRY_ATTEMPTS,
      },
    });
  });

  async function executeSessionLaunch(sessionId: number): Promise<{
    ok: boolean;
    statusCode: number;
    session: ReturnType<typeof getTestSessionById>;
    error?: string;
  }> {
    const source = getTestSessionById(sessionId);
    if (!source) {
      return { ok: false, statusCode: 404, session: null, error: 'Test session not found.' };
    }

    const settings = getAppSettings();
    const agentStatus = await checkAgentInterface();
    if (!agentStatus.reachable) {
      const msg =
        agentStatus.error ||
        `Local Chrome agent is unreachable on ${AGENT_HOST}:${AGENT_PORT}. Start it on your PC with: npm run agent`;
      const failed = markSessionFailed(source.id, msg);
      return { ok: false, statusCode: 503, session: failed, error: msg };
    }

    if (!agentStatus.authenticated) {
      const msg = agentStatus.error || 'Local Chrome agent authentication failed.';
      const failed = markSessionFailed(source.id, msg);
      return { ok: false, statusCode: 401, session: failed, error: msg };
    }

    if (!agentStatus.chrome.installed) {
      const msg =
        agentStatus.chrome.error ||
        'Google Chrome was not detected on this PC. Install Google Chrome before launching tests.';
      const failed = markSessionFailed(source.id, msg);
      return { ok: false, statusCode: 503, session: failed, error: msg };
    }

    const dispatch = await dispatchSessionStartToAgent(
      source.agentPayload,
      settings.allowLocalDevTargets
    );

    if (!dispatch.accepted) {
      const msg =
        dispatch.error ||
        dispatch.failedInstances[0]?.error ||
        'Local Chrome agent declined or failed to launch Chrome windows.';
      const failed = markSessionFailed(source.id, msg);
      return { ok: false, statusCode: dispatch.statusCode, session: failed, error: msg };
    }

    const updated = getTestSessionById(source.id);
    return { ok: true, statusCode: 201, session: updated };
  }

  app.post('/api/tests', async (req, res) => {
    if (!checkLaunchRateLimit(res)) return;

    const validation = validateCreateSessionRequest(req.body);
    if (!validation.valid) {
      res.status(validation.statusCode).json({ error: validation.error });
      return;
    }

    const settings = getAppSettings();
    const dnsCheck = await verifyUrlDnsSafety(
      validation.data.domain,
      settings.allowLocalDevTargets
    );
    if (!dnsCheck.safe) {
      res.status(403).json({ error: dnsCheck.error });
      return;
    }

    const agentStatus = await checkAgentInterface();
    if (!agentStatus.reachable) {
      res.status(503).json({
        error:
          agentStatus.error ||
          `Local Chrome agent is offline on ${AGENT_HOST}:${AGENT_PORT}. Run "npm run agent" on your PC first.`,
      });
      return;
    }

    if (!agentStatus.authenticated) {
      res.status(401).json({
        error: agentStatus.error || 'Local Chrome agent rejected authentication.',
      });
      return;
    }

    if (!agentStatus.chrome.installed) {
      res.status(503).json({
        error:
          agentStatus.chrome.error ||
          'Google Chrome is not installed on your PC. Install Chrome to launch sessions.',
      });
      return;
    }

    const session = createTestSession(validation.data);
    const launchResult = await executeSessionLaunch(session.id);

    if (!launchResult.ok) {
      res.status(launchResult.statusCode).json({
        error: launchResult.error,
        session: launchResult.session,
      });
      return;
    }

    res.status(201).json({
      session: launchResult.session,
      message: `Launched ${validation.data.quantity} isolated Chrome (${validation.data.mode}) QA session(s).`,
    });
  });

  app.post('/api/tests/:id/retry', async (req, res) => {
    if (!checkLaunchRateLimit(res)) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid session id.' });
      return;
    }

    const source = getTestSessionById(id);
    if (!source) {
      res.status(404).json({ error: 'Original test session not found.' });
      return;
    }

    const retryCheck = validateRetryEligibility(
      source.status,
      source.retryAttempt,
      source.quantity
    );
    if (!retryCheck.valid) {
      res.status(retryCheck.statusCode).json({ error: retryCheck.error });
      return;
    }

    const settings = getAppSettings();
    const urlCheck = validateAuthorizedTestUrl(source.url, {
      requireAllowlist: true,
      allowLocalDevTargets: settings.allowLocalDevTargets,
    });
    if (!urlCheck.valid) {
      res.status(urlCheck.statusCode).json({ error: urlCheck.error });
      return;
    }

    const dnsCheck = await verifyUrlDnsSafety(urlCheck.hostname, settings.allowLocalDevTargets);
    if (!dnsCheck.safe) {
      res.status(403).json({ error: dnsCheck.error });
      return;
    }

    const agentStatus = await checkAgentInterface();
    if (!agentStatus.reachable) {
      res.status(503).json({
        error:
          agentStatus.error ||
          `Local Chrome agent is offline on ${AGENT_HOST}:${AGENT_PORT}. Run "npm run agent" on your PC first.`,
      });
      return;
    }

    if (!agentStatus.authenticated) {
      res.status(401).json({
        error: agentStatus.error || 'Local Chrome agent rejected authentication.',
      });
      return;
    }

    if (!agentStatus.chrome.installed) {
      res.status(503).json({
        error: agentStatus.chrome.error || 'Google Chrome is not installed on your PC.',
      });
      return;
    }

    const retriedSession = createTestSession({
      testType: source.testType,
      url: urlCheck.url,
      domain: urlCheck.hostname,
      quantity: source.quantity,
      mode: source.mode,
      qaConfig: source.qaConfig,
      retryOfSessionId: source.id,
      retryAttempt: source.retryAttempt + 1,
    });

    const launchResult = await executeSessionLaunch(retriedSession.id);
    if (!launchResult.ok) {
      res.status(launchResult.statusCode).json({
        error: launchResult.error,
        session: launchResult.session,
      });
      return;
    }

    res.status(201).json({
      session: launchResult.session,
      message: `Retried failed session #${source.id} as new session #${retriedSession.id} (attempt ${retriedSession.retryAttempt}/${MAX_RETRY_ATTEMPTS}).`,
    });
  });

  app.post('/api/tests/:id/stop', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid session id.' });
      return;
    }

    const existing = getTestSessionById(id);
    if (!existing) {
      res.status(404).json({ error: 'Test session not found.' });
      return;
    }

    const stopRes = await stopAgentSession(id);
    const updated = markSessionStopped(
      id,
      stopRes.reachable
        ? 'Stopped by user; temporary profile cleaned up'
        : 'Marked stopped in dashboard (local agent unreachable)'
    );

    res.json({
      stopped: true,
      agentReachable: stopRes.reachable,
      stoppedInstances: stopRes.stoppedCount,
      session: updated,
    });
  });

  app.post('/api/tests/:id/instances/:instanceIndex/stop', async (req, res) => {
    const id = Number(req.params.id);
    const instanceIndex = Number(req.params.instanceIndex);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(instanceIndex) || instanceIndex <= 0) {
      res.status(400).json({ error: 'Invalid session or instance id.' });
      return;
    }

    const instanceUid = `bt-${id}-${instanceIndex}`;
    const stopRes = await stopAgentInstance(instanceUid);
    const updated = updateSessionFromAgentReport(id, undefined, [
      {
        instanceIndex,
        status: 'stopped',
        scrollStatus: 'stopped',
        message: stopRes.reachable
          ? 'Instance stopped by user; temporary profile cleaned up.'
          : 'Instance marked stopped (local agent unreachable).',
      },
    ]);

    if (!updated) {
      res.status(404).json({ error: 'Test session not found.' });
      return;
    }

    res.json({
      stopped: true,
      instanceUid,
      session: updated,
    });
  });

  app.post('/api/tests/stop-all', async (_req, res) => {
    const stopRes = await stopAllAgentSessions();
    const updatedCount = markAllActiveSessionsStopped(
      stopRes.reachable
        ? 'All sessions stopped by user; temporary profiles cleaned up'
        : 'Marked stopped in dashboard (local agent unreachable)'
    );

    res.json({
      stopped: true,
      agentReachable: stopRes.reachable,
      stoppedInstances: stopRes.stoppedCount,
      updatedSessions: updatedCount,
    });
  });

  app.delete('/api/tests', (_req, res) => {
    const deletedCount = clearFinishedHistory();
    res.json({ cleared: true, deletedCount });
  });

  app.delete('/api/tests/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid session id.' });
      return;
    }

    const existing = getTestSessionById(id);
    if (!existing) {
      res.status(404).json({ error: 'Test session not found.' });
      return;
    }

    if (existing.status === 'running' || existing.status === 'pending') {
      await stopAgentSession(id);
    }

    deleteTestSession(id);
    res.json({ deleted: true, id });
  });

  app.post('/api/agent/sessions/:id/report', (req, res) => {
    if (!isLoopbackRemoteAddress(req.socket.remoteAddress)) {
      res.status(403).json({
        error: 'Agent report callbacks are restricted to loopback (127.0.0.1) connections only.',
      });
      return;
    }

    const tokenHeader = req.headers['x-agent-token'];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!verifyAgentAuthToken(token)) {
      res.status(401).json({ error: 'Unauthorized agent callback token.' });
      return;
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid session id.' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body) {
      res.status(400).json({ error: 'Invalid report body.' });
      return;
    }

    const explicitStatus = body.status !== undefined ? body.status : undefined;
    if (explicitStatus !== undefined && !isValidStatus(explicitStatus)) {
      res.status(400).json({ error: 'Invalid session status.' });
      return;
    }

    const rawResults = Array.isArray(body.results) ? body.results : [];
    const results: AgentResultReportItem[] = [];
    for (const item of rawResults) {
      if (
        item &&
        typeof item === 'object' &&
        Number.isInteger((item as Record<string, unknown>).instanceIndex) &&
        isValidStatus((item as Record<string, unknown>).status)
      ) {
        const record = item as Record<string, unknown>;
        results.push({
          instanceIndex: Number(record.instanceIndex),
          status: record.status as AgentResultReportItem['status'],
          httpStatus: typeof record.httpStatus === 'number' ? record.httpStatus : null,
          loadTimeMs: typeof record.loadTimeMs === 'number' ? record.loadTimeMs : null,
          finalUrl: typeof record.finalUrl === 'string' ? record.finalUrl.slice(0, 2048) : null,
          pageTitle: typeof record.pageTitle === 'string' ? record.pageTitle.slice(0, 300) : null,
          pageLoadStatus:
            typeof record.pageLoadStatus === 'string'
              ? (record.pageLoadStatus as AgentResultReportItem['pageLoadStatus'])
              : undefined,
          scrollStatus:
            typeof record.scrollStatus === 'string'
              ? (record.scrollStatus as AgentResultReportItem['scrollStatus'])
              : undefined,
          scrollSteps: typeof record.scrollSteps === 'number' ? record.scrollSteps : undefined,
          maxScrollSteps:
            typeof record.maxScrollSteps === 'number' ? record.maxScrollSteps : undefined,
          scrollProgressPct:
            typeof record.scrollProgressPct === 'number' ? record.scrollProgressPct : undefined,
          initialHeight: typeof record.initialHeight === 'number' ? record.initialHeight : null,
          finalHeight: typeof record.finalHeight === 'number' ? record.finalHeight : null,
          heightChanges:
            typeof record.heightChanges === 'number' ? record.heightChanges : undefined,
          lazyLoadedDetected:
            typeof record.lazyLoadedDetected === 'boolean'
              ? record.lazyLoadedDetected
              : undefined,
          videoVisible:
            typeof record.videoVisible === 'boolean' ? record.videoVisible : null,
          videoPlaybackStatus:
            typeof record.videoPlaybackStatus === 'string'
              ? (record.videoPlaybackStatus as AgentResultReportItem['videoPlaybackStatus'])
              : undefined,
          videoError: typeof record.videoError === 'string' ? record.videoError.slice(0, 500) : null,
          message: typeof record.message === 'string' ? record.message.slice(0, 500) : null,
        });
      }
    }

    const errorMessage = typeof body.errorMessage === 'string' ? body.errorMessage.slice(0, 500) : null;
    const updated = updateSessionFromAgentReport(id, explicitStatus, results, errorMessage);
    if (!updated) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    res.json({ session: updated });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof SyntaxError && 'body' in err) {
        res.status(400).json({ error: 'Malformed JSON request body.' });
        return;
      }
      const safeMsg =
        process.env.NODE_ENV === 'production'
          ? 'Internal server error.'
          : err.message || 'Internal server error.';
      res.status(500).json({ error: safeMsg });
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(SERVER_PORT, '0.0.0.0', () => {
    console.log(`[Browser Tester] Web dashboard listening on http://localhost:${SERVER_PORT}`);
    console.log(
      `[Browser Tester] Expecting local Chrome agent strictly on http://${AGENT_HOST}:${AGENT_PORT}`
    );
  });
}

startServer().catch((err) => {
  console.error('[Browser Tester] Fatal startup error:', err);
  process.exit(1);
});
