import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { QaScrollConfig } from '../src/types/testing.ts';

export const SERVER_PORT = Number(process.env.PORT || 3000);

const configuredAgentHost = (process.env.AGENT_HOST || '127.0.0.1').trim();
if (configuredAgentHost !== '127.0.0.1') {
  throw new Error(
    `Security policy violation: AGENT_HOST must be bound strictly to 127.0.0.1 (received "${configuredAgentHost}").`
  );
}

export const AGENT_HOST = '127.0.0.1' as const;
export const AGENT_PORT = Number(process.env.AGENT_PORT || 47120);

export const DB_PATH = process.env.SQLITE_DB_PATH
  ? path.resolve(process.env.SQLITE_DB_PATH)
  : path.resolve(process.cwd(), 'data', 'browser-tester.db');

export const AGENT_TOKEN_FILE = path.resolve(path.dirname(DB_PATH), '.agent-token');

export const ALLOWED_BROWSER = 'Chrome' as const;
export const DEFAULT_MAX_QUANTITY_PER_SESSION = 5;
export const DEFAULT_MAX_ACTIVE_INSTANCES = 5;
export const HARD_MAX_QUANTITY_PER_SESSION = 5;
export const HARD_MAX_ACTIVE_INSTANCES = 10;
export const MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_ALLOW_LOCAL_DEV_TARGETS = process.env.ALLOW_LOCAL_DEV_TARGETS === 'true';

export const DEFAULT_QA_SCROLL_CONFIG: QaScrollConfig = {
  scrollEnabled: true,
  scrollIntervalMs: 600,
  scrollDistancePx: 500,
  maxScrollCount: 15,
  noNewContentThreshold: 3,
  maxDurationMs: 45_000,
};

export function getDashboardCallbackBaseUrl(): string {
  const raw = (process.env.DASHBOARD_CALLBACK_URL || `http://127.0.0.1:${SERVER_PORT}`).trim();
  const parsed = new URL(raw);
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      `Security policy violation: DASHBOARD_CALLBACK_URL must target loopback (127.0.0.1/localhost), got "${parsed.hostname}".`
    );
  }
  return parsed.origin;
}

let cachedAgentToken: string | null = null;

export function getAgentAuthToken(): string {
  if (cachedAgentToken) {
    return cachedAgentToken;
  }

  const envToken = process.env.AGENT_AUTH_TOKEN?.trim();
  if (envToken && envToken.length >= 16) {
    cachedAgentToken = envToken;
    return cachedAgentToken;
  }

  const dir = path.dirname(AGENT_TOKEN_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(AGENT_TOKEN_FILE)) {
    const fileToken = fs.readFileSync(AGENT_TOKEN_FILE, 'utf8').trim();
    if (fileToken.length >= 32) {
      cachedAgentToken = fileToken;
      return cachedAgentToken;
    }
  }

  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(AGENT_TOKEN_FILE, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
  cachedAgentToken = generated;
  return cachedAgentToken;
}

export function verifyAgentAuthToken(providedToken: string | undefined): boolean {
  if (!providedToken || typeof providedToken !== 'string') {
    return false;
  }
  const expected = getAgentAuthToken();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const providedDigest = crypto.createHash('sha256').update(providedToken.trim(), 'utf8').digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}
