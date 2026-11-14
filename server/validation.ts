import dns from 'node:dns/promises';
import net from 'node:net';
import type { QaScrollConfig, TestMode, TestStatus, TestType } from '../src/types/testing.ts';
import { ALLOWED_BROWSER, DEFAULT_QA_SCROLL_CONFIG, MAX_RETRY_ATTEMPTS } from './config.ts';
import { getAppSettings, getStatusCounts, isDomainAuthorized } from './db.ts';

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  '0.0.0.0',
  '::',
  '[::]',
]);

const BLOCKED_AD_OR_ABUSE_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'adnxs.com',
  'adsrvr.org',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'pubmatic.com',
];

const BLOCKED_ENGAGEMENT_MANIPULATION_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'tiktok.com',
];

const BLOCKED_ABUSE_KEYWORDS = [
  'viewbot',
  'fake-views',
  'buy-views',
  'ad-click',
  'clickfarm',
  'auto_subscribe',
];

function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function isLoopbackAddress(host: string): boolean {
  const clean = stripIpv6Brackets(host.toLowerCase());
  return (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean.startsWith('127.')
  );
}

export function isPrivateOrRestrictedIp(ipOrHost: string): boolean {
  const clean = stripIpv6Brackets(ipOrHost.toLowerCase());

  if (BLOCKED_METADATA_HOSTS.has(clean)) {
    return true;
  }

  const version = net.isIP(clean);
  if (version === 4) {
    const parts = clean.split('.').map((n) => Number.parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (version === 6) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fe80:') || clean.startsWith('fc') || clean.startsWith('fd')) return true;
    if (clean.startsWith('::ffff:')) {
      const v4Part = clean.slice('::ffff:'.length);
      return isPrivateOrRestrictedIp(v4Part);
    }
    return false;
  }

  if (clean.endsWith('.local') || clean.endsWith('.internal') || clean.endsWith('.localhost')) {
    return true;
  }

  return false;
}

export function normalizeDomainInput(
  rawDomain: string,
  allowLocalDevTargets = getAppSettings().allowLocalDevTargets
):
  | { valid: true; domain: string }
  | { valid: false; error: string } {
  const trimmed = rawDomain.trim().toLowerCase();
  if (!trimmed) {
    return { valid: false, error: 'Domain is required.' };
  }

  if (trimmed.includes('*')) {
    return {
      valid: false,
      error: 'Wildcard domains are not permitted. Enter an explicit hostname.',
    };
  }

  let candidate = trimmed;
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    try {
      const parsed = new URL(candidate);
      candidate = parsed.hostname.toLowerCase();
    } catch {
      return { valid: false, error: 'Invalid domain format.' };
    }
  } else {
    candidate = candidate.split('/')[0].split(':')[0];
  }

  candidate = stripIpv6Brackets(candidate);

  if (!candidate || candidate.length > 253) {
    return { valid: false, error: 'Invalid domain length.' };
  }

  if (BLOCKED_METADATA_HOSTS.has(candidate) || candidate.startsWith('169.254.')) {
    return {
      valid: false,
      error: 'Internal metadata or unspecified network hosts cannot be authorized.',
    };
  }

  if (isLoopbackAddress(candidate) || isPrivateOrRestrictedIp(candidate)) {
    if (allowLocalDevTargets && isLoopbackAddress(candidate)) {
      return { valid: true, domain: candidate };
    }
    return {
      valid: false,
      error:
        'Localhost, private IPs, and internal hosts are blocked unless Local Development Mode is explicitly enabled in Settings.',
    };
  }

  if (
    BLOCKED_AD_OR_ABUSE_DOMAINS.some(
      (blocked) => candidate === blocked || candidate.endsWith(`.${blocked}`)
    )
  ) {
    return {
      valid: false,
      error: 'Advertising network domains cannot be added as test targets.',
    };
  }

  if (
    BLOCKED_ENGAGEMENT_MANIPULATION_DOMAINS.some(
      (blocked) => candidate === blocked || candidate.endsWith(`.${blocked}`)
    )
  ) {
    return {
      valid: false,
      error: 'Third-party video platform domains cannot be automated for playback/view testing.',
    };
  }

  const domainRegex = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})$/;
  if (!domainRegex.test(candidate)) {
    return {
      valid: false,
      error: 'Enter a valid hostname (for example: example.com or staging.myapp.dev).',
    };
  }

  return { valid: true, domain: candidate };
}

export type UrlValidationResult =
  | { valid: true; url: string; hostname: string }
  | { valid: false; statusCode: number; error: string };

export function validateAuthorizedTestUrl(
  rawUrl: string,
  options?: { requireAllowlist?: boolean; allowLocalDevTargets?: boolean }
): UrlValidationResult {
  const requireAllowlist = options?.requireAllowlist ?? true;
  const allowLocalDevTargets =
    options?.allowLocalDevTargets ?? getAppSettings().allowLocalDevTargets;

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, statusCode: 400, error: 'Target URL is required.' };
  }

  if (trimmed.length > 2048) {
    return { valid: false, statusCode: 400, error: 'URL exceeds the 2048 character limit.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      statusCode: 400,
      error: 'Enter a valid absolute URL starting with http:// or https://.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      statusCode: 400,
      error: 'Only http:// and https:// URLs are supported.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      statusCode: 400,
      error: 'URLs containing embedded credentials are not allowed.',
    };
  }

  const hostname = stripIpv6Brackets(parsed.hostname.toLowerCase());
  if (!hostname) {
    return { valid: false, statusCode: 400, error: 'URL must include a valid hostname.' };
  }

  if (BLOCKED_METADATA_HOSTS.has(hostname) || hostname.startsWith('169.254.')) {
    return {
      valid: false,
      statusCode: 403,
      error: 'Cloud metadata and link-local addresses are blocked.',
    };
  }

  if (isLoopbackAddress(hostname) || isPrivateOrRestrictedIp(hostname)) {
    if (!(allowLocalDevTargets && isLoopbackAddress(hostname))) {
      return {
        valid: false,
        statusCode: 403,
        error:
          'Localhost, private IPs, and internal hosts are blocked unless Local Development Mode is explicitly enabled.',
      };
    }
  }

  if (
    BLOCKED_AD_OR_ABUSE_DOMAINS.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`)
    )
  ) {
    return {
      valid: false,
      statusCode: 403,
      error: 'Ad network URLs are prohibited by Browser Tester policy.',
    };
  }

  if (
    BLOCKED_ENGAGEMENT_MANIPULATION_DOMAINS.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`)
    )
  ) {
    return {
      valid: false,
      statusCode: 403,
      error:
        'Automated playback on YouTube, Instagram, Facebook, TikTok, and other third-party social/video platforms is prohibited. Test only authorized websites you own.',
    };
  }

  const lowerFull = parsed.toString().toLowerCase();
  if (BLOCKED_ABUSE_KEYWORDS.some((kw) => lowerFull.includes(kw))) {
    return {
      valid: false,
      statusCode: 403,
      error:
        'URL violates acceptable QA policy (artificial engagement or ad automation prohibited).',
    };
  }

  if (requireAllowlist && !isDomainAuthorized(hostname)) {
    return {
      valid: false,
      statusCode: 403,
      error: `Domain "${hostname}" is not in your Authorized Domains list. Add and confirm ownership before running tests.`,
    };
  }

  return {
    valid: true,
    url: parsed.toString(),
    hostname,
  };
}

export async function verifyUrlDnsSafety(
  hostname: string,
  allowLocalDevTargets = getAppSettings().allowLocalDevTargets
): Promise<{ safe: true } | { safe: false; error: string }> {
  const clean = stripIpv6Brackets(hostname.toLowerCase());
  if (net.isIP(clean) !== 0 || clean === 'localhost') {
    if (isLoopbackAddress(clean) && allowLocalDevTargets) {
      return { safe: true };
    }
    if (isPrivateOrRestrictedIp(clean)) {
      return { safe: false, error: `Destination "${clean}" resolves to a restricted IP range.` };
    }
    return { safe: true };
  }

  try {
    const records = await dns.lookup(clean, { all: true });
    for (const rec of records) {
      if (isPrivateOrRestrictedIp(rec.address)) {
        if (allowLocalDevTargets && isLoopbackAddress(rec.address)) {
          continue;
        }
        return {
          safe: false,
          error: `Domain "${clean}" resolves to a restricted/private IP (${rec.address}).`,
        };
      }
    }
    return { safe: true };
  } catch {
    return { safe: true };
  }
}

export function validateQaScrollConfig(raw: unknown):
  | { valid: true; config: QaScrollConfig }
  | { valid: false; error: string } {
  if (raw === undefined || raw === null) {
    return { valid: true, config: { ...DEFAULT_QA_SCROLL_CONFIG } };
  }

  if (typeof raw !== 'object') {
    return { valid: false, error: 'qaConfig must be an object.' };
  }

  const input = raw as Record<string, unknown>;
  const scrollEnabled =
    input.scrollEnabled !== undefined
      ? Boolean(input.scrollEnabled)
      : DEFAULT_QA_SCROLL_CONFIG.scrollEnabled;

  const scrollIntervalMs =
    input.scrollIntervalMs !== undefined
      ? Number(input.scrollIntervalMs)
      : DEFAULT_QA_SCROLL_CONFIG.scrollIntervalMs;
  if (!Number.isInteger(scrollIntervalMs) || scrollIntervalMs < 250 || scrollIntervalMs > 5000) {
    return { valid: false, error: 'Scroll interval must be between 250 ms and 5000 ms.' };
  }

  const scrollDistancePx =
    input.scrollDistancePx !== undefined
      ? Number(input.scrollDistancePx)
      : DEFAULT_QA_SCROLL_CONFIG.scrollDistancePx;
  if (!Number.isInteger(scrollDistancePx) || scrollDistancePx < 100 || scrollDistancePx > 2500) {
    return { valid: false, error: 'Scroll distance must be between 100 px and 2500 px.' };
  }

  const maxScrollCount =
    input.maxScrollCount !== undefined
      ? Number(input.maxScrollCount)
      : DEFAULT_QA_SCROLL_CONFIG.maxScrollCount;
  if (!Number.isInteger(maxScrollCount) || maxScrollCount < 1 || maxScrollCount > 60) {
    return { valid: false, error: 'Max scroll count must be between 1 and 60.' };
  }

  const noNewContentThreshold =
    input.noNewContentThreshold !== undefined
      ? Number(input.noNewContentThreshold)
      : DEFAULT_QA_SCROLL_CONFIG.noNewContentThreshold;
  if (
    !Number.isInteger(noNewContentThreshold) ||
    noNewContentThreshold < 1 ||
    noNewContentThreshold > 10
  ) {
    return {
      valid: false,
      error: 'No-new-content check threshold must be between 1 and 10.',
    };
  }

  const maxDurationMs =
    input.maxDurationMs !== undefined
      ? Number(input.maxDurationMs)
      : DEFAULT_QA_SCROLL_CONFIG.maxDurationMs;
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 5000 || maxDurationMs > 180000) {
    return {
      valid: false,
      error: 'Max test duration must be between 5000 ms (5s) and 180000 ms (180s).',
    };
  }

  return {
    valid: true,
    config: {
      scrollEnabled,
      scrollIntervalMs,
      scrollDistancePx,
      maxScrollCount,
      noNewContentThreshold,
      maxDurationMs,
    },
  };
}

export interface ValidatedSessionPayload {
  testType: TestType;
  url: string;
  domain: string;
  browser: 'Chrome';
  quantity: number;
  mode: TestMode;
  qaConfig: QaScrollConfig;
}

export function validateCreateSessionRequest(body: unknown):
  | { valid: true; data: ValidatedSessionPayload }
  | { valid: false; statusCode: number; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, statusCode: 400, error: 'Invalid request body.' };
  }

  const payload = body as Record<string, unknown>;
  const settings = getAppSettings();

  const testType = payload.testType;
  if (testType !== 'Website Test' && testType !== 'Video Playback Test') {
    return {
      valid: false,
      statusCode: 400,
      error: 'Test Type must be either "Website Test" or "Video Playback Test".',
    };
  }

  const browser = payload.browser ?? ALLOWED_BROWSER;
  if (browser !== ALLOWED_BROWSER) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Only Chrome browser is supported in Browser Tester.',
    };
  }

  const mode = payload.mode;
  if (mode !== 'Normal' && mode !== 'Incognito') {
    return {
      valid: false,
      statusCode: 400,
      error: 'Mode must be either "Normal" or "Incognito".',
    };
  }

  const rawQuantity = Number(payload.quantity);
  if (
    !Number.isInteger(rawQuantity) ||
    rawQuantity < 1 ||
    rawQuantity > settings.maxQuantityPerSession
  ) {
    return {
      valid: false,
      statusCode: 400,
      error: `Quantity must be an integer between 1 and ${settings.maxQuantityPerSession}.`,
    };
  }

  if (payload.authorizationConfirmed !== true) {
    return {
      valid: false,
      statusCode: 400,
      error: 'You must confirm domain ownership or explicit testing authorization.',
    };
  }

  if (typeof payload.url !== 'string') {
    return { valid: false, statusCode: 400, error: 'Target URL must be a string.' };
  }

  const urlCheck = validateAuthorizedTestUrl(payload.url, {
    requireAllowlist: true,
    allowLocalDevTargets: settings.allowLocalDevTargets,
  });
  if (!urlCheck.valid) {
    return urlCheck;
  }

  const qaConfigCheck = validateQaScrollConfig(payload.qaConfig);
  if (!qaConfigCheck.valid) {
    return { valid: false, statusCode: 400, error: qaConfigCheck.error };
  }

  const counts = getStatusCounts();
  if (counts.activeInstances + rawQuantity > settings.maxActiveInstances) {
    return {
      valid: false,
      statusCode: 429,
      error: `Concurrency limit reached (${counts.activeInstances}/${settings.maxActiveInstances} active slots in use). Stop running sessions or adjust concurrency before adding ${rawQuantity} more.`,
    };
  }

  return {
    valid: true,
    data: {
      testType,
      url: urlCheck.url,
      domain: urlCheck.hostname,
      browser: ALLOWED_BROWSER,
      quantity: rawQuantity,
      mode,
      qaConfig: qaConfigCheck.config,
    },
  };
}

export function validateRetryEligibility(
  status: TestStatus,
  retryAttempt: number,
  quantity: number
):
  | { valid: true }
  | { valid: false; statusCode: number; error: string } {
  if (status !== 'failed' && status !== 'timed_out') {
    return {
      valid: false,
      statusCode: 400,
      error: 'Manual retry is only permitted for failed or timed-out sessions.',
    };
  }

  if (retryAttempt >= MAX_RETRY_ATTEMPTS) {
    return {
      valid: false,
      statusCode: 400,
      error: `Maximum manual retry depth (${MAX_RETRY_ATTEMPTS}) reached for this session chain. Create a new test session instead.`,
    };
  }

  const settings = getAppSettings();
  const counts = getStatusCounts();
  if (counts.activeInstances + quantity > settings.maxActiveInstances) {
    return {
      valid: false,
      statusCode: 429,
      error: `Concurrency limit reached (${counts.activeInstances}/${settings.maxActiveInstances} active slots in use). Cannot retry ${quantity} instances right now.`,
    };
  }
  return { valid: true };
}

export function isValidStatus(status: unknown): status is TestStatus {
  return (
    status === 'pending' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'stopped' ||
    status === 'timed_out'
  );
}
