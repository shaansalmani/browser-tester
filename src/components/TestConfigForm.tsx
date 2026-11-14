import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lock,
  Play,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  AuthorizedDomain,
  ConcurrencyLimits,
  HealthResponse,
  QaScrollConfig,
  TestMode,
  TestSession,
  TestStatusCounts,
  TestType,
} from '../types/testing.ts';

interface TestConfigFormProps {
  authorizedDomains: AuthorizedDomain[];
  counts: TestStatusCounts;
  limits: ConcurrencyLimits;
  health: HealthResponse | null;
  selectedSessionForRetry: TestSession | null;
  submitting: boolean;
  retrying: boolean;
  feedback: { type: 'success' | 'error'; message: string } | null;
  onGenerate: (payload: {
    testType: TestType;
    url: string;
    browser: 'Chrome';
    quantity: number;
    mode: TestMode;
    authorizationConfirmed: boolean;
    qaConfig: QaScrollConfig;
  }) => Promise<void>;
  onRetrySelected: () => Promise<void>;
  onQuickAuthorizeDomain: (domain: string) => Promise<void>;
}

function isClientRestrictedHost(hostname: string, allowLocalDevTargets: boolean): string | null {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopback = clean === 'localhost' || clean === '::1' || clean.startsWith('127.');
  const isPrivateV4 =
    clean.startsWith('10.') ||
    clean.startsWith('192.168.') ||
    clean.startsWith('169.254.') ||
    clean === '0.0.0.0' ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(clean);
  const isRestrictedSuffix =
    clean.endsWith('.local') || clean.endsWith('.internal') || clean.endsWith('.localhost');

  if (clean === '169.254.169.254' || clean === 'metadata.google.internal') {
    return 'Cloud metadata addresses are blocked.';
  }

  if (
    clean === 'youtube.com' ||
    clean.endsWith('.youtube.com') ||
    clean === 'youtu.be' ||
    clean === 'youtube-nocookie.com'
  ) {
    return 'YouTube and third-party video platform playback automation is prohibited.';
  }

  if ((isLoopback || isPrivateV4 || isRestrictedSuffix) && !(allowLocalDevTargets && isLoopback)) {
    return 'Localhost and private IPs are blocked unless Local Development Mode is enabled in Settings.';
  }

  return null;
}

export function TestConfigForm({
  authorizedDomains,
  counts,
  limits,
  health,
  selectedSessionForRetry,
  submitting,
  retrying,
  feedback,
  onGenerate,
  onRetrySelected,
  onQuickAuthorizeDomain,
}: TestConfigFormProps) {
  const [testType, setTestType] = useState<TestType>('Website Test');
  const [url, setUrl] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [mode, setMode] = useState<TestMode>('Normal');
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);

  const [showScrollOptions, setShowScrollOptions] = useState(true);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [scrollIntervalMs, setScrollIntervalMs] = useState(600);
  const [scrollDistancePx, setScrollDistancePx] = useState(500);
  const [maxScrollCount, setMaxScrollCount] = useState(15);
  const [noNewContentThreshold, setNoNewContentThreshold] = useState(3);
  const [maxDurationSec, setMaxDurationSec] = useState(45);

  const [localError, setLocalError] = useState<string | null>(null);
  const [authorizingHost, setAuthorizingHost] = useState(false);

  useEffect(() => {
    setQuantity((prev) => Math.min(Math.max(prev, 1), limits.maxQuantityPerSession));
  }, [limits.maxQuantityPerSession]);

  const urlInspection = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      return { state: 'empty' as const, hostname: null, message: null };
    }

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          state: 'invalid' as const,
          hostname: null,
          message: 'Only http:// and https:// URLs are permitted.',
        };
      }

      const hostname = parsed.hostname.toLowerCase();
      const restrictedError = isClientRestrictedHost(hostname, limits.allowLocalDevTargets);
      if (restrictedError) {
        return {
          state: 'invalid' as const,
          hostname,
          message: restrictedError,
        };
      }

      const isAuthorized = authorizedDomains.some(
        (d) => hostname === d.domain.toLowerCase() || hostname.endsWith(`.${d.domain.toLowerCase()}`)
      );

      if (!isAuthorized) {
        return {
          state: 'unauthorized' as const,
          hostname,
          message: `Domain "${hostname}" is not yet in your Authorized Domains list.`,
        };
      }

      return { state: 'authorized' as const, hostname, message: null };
    } catch {
      return {
        state: 'invalid' as const,
        hostname: null,
        message: 'Enter a valid absolute URL (example: https://example.com).',
      };
    }
  }, [url, authorizedDomains, limits.allowLocalDevTargets]);

  const remainingSlots = Math.max(0, limits.maxActiveInstances - counts.activeInstances);
  const agentReady =
    Boolean(health?.agentInterface.reachable) &&
    Boolean(health?.agentInterface.authenticated) &&
    Boolean(health?.agentInterface.chrome.installed);

  const retryEligible =
    selectedSessionForRetry !== null &&
    (selectedSessionForRetry.status === 'failed' ||
      selectedSessionForRetry.status === 'timed_out') &&
    selectedSessionForRetry.retryAttempt < limits.maxRetryAttempts;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    if (urlInspection.state === 'empty' || urlInspection.state === 'invalid') {
      setLocalError(urlInspection.message || 'Enter a valid http:// or https:// URL.');
      return;
    }

    if (urlInspection.state === 'unauthorized') {
      setLocalError(
        `Domain "${urlInspection.hostname}" must be authorized before launching a test session.`
      );
      return;
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > limits.maxQuantityPerSession) {
      setLocalError(`Quantity must be between 1 and ${limits.maxQuantityPerSession}.`);
      return;
    }

    if (quantity > remainingSlots) {
      setLocalError(
        `Only ${remainingSlots} concurrency slot(s) remaining out of ${limits.maxActiveInstances}.`
      );
      return;
    }

    if (!authorizationConfirmed) {
      setLocalError('Confirm domain ownership or testing authorization before proceeding.');
      return;
    }

    await onGenerate({
      testType,
      url: url.trim(),
      browser: 'Chrome',
      quantity,
      mode,
      authorizationConfirmed,
      qaConfig: {
        scrollEnabled: testType === 'Website Test' ? scrollEnabled : false,
        scrollIntervalMs,
        scrollDistancePx,
        maxScrollCount,
        noNewContentThreshold,
        maxDurationMs: maxDurationSec * 1000,
      },
    });
  }

  async function handleQuickAuthorize() {
    if (!urlInspection.hostname) return;
    setAuthorizingHost(true);
    setLocalError(null);
    try {
      await onQuickAuthorizeDomain(urlInspection.hostname);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to authorize domain.');
    } finally {
      setAuthorizingHost(false);
    }
  }

  const activeMessage = localError
    ? { type: 'error' as const, message: localError }
    : feedback;

  return (
    <section
      id="configure"
      aria-labelledby="configure-heading"
      className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-5 border-b border-slate-200 pb-4 dark:border-slate-800">
        <h2
          id="configure-heading"
          className="text-base font-semibold text-slate-900 dark:text-slate-50"
        >
          Configure QA Test
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Run Website QA, controlled scrolling, or Video Playback checks in isolated Chrome sessions.
        </p>
      </div>

      {health && !agentReady && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              {!health.agentInterface.reachable
                ? 'Local Chrome agent is offline (127.0.0.1:47120)'
                : !health.agentInterface.authenticated
                  ? 'Local agent authentication mismatch'
                  : 'Google Chrome not detected on this PC'}
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
              {!health.agentInterface.reachable
                ? 'Run "npm run agent" on your PC before clicking Generate. Real Chrome windows will not open without the local agent.'
                : health.agentInterface.chrome.error || health.agentInterface.error}
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            Test Type
          </label>
          <div
            role="radiogroup"
            aria-label="Test Type"
            className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950"
          >
            {(['Website Test', 'Video Playback Test'] as const).map((option) => {
              const active = testType === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTestType(option)}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor="target-url"
            className="block text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            Target URL
          </label>
          <input
            id="target-url"
            name="url"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (localError) setLocalError(null);
            }}
            placeholder="https://staging.yourdomain.com/player"
            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />

          {urlInspection.state === 'invalid' && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{urlInspection.message}</span>
            </p>
          )}

          {urlInspection.state === 'unauthorized' && urlInspection.hostname && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <span className="flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{urlInspection.message}</span>
              </span>
              <button
                type="button"
                disabled={authorizingHost}
                onClick={handleQuickAuthorize}
                className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {authorizingHost
                  ? 'Authorizing...'
                  : `Authorize ${urlInspection.hostname}`}
              </button>
            </div>
          )}

          {urlInspection.state === 'authorized' && urlInspection.hostname && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Authorized domain: {urlInspection.hostname}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="browser-select"
              className="block text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              Browser
            </label>
            <div className="relative mt-2">
              <input
                id="browser-select"
                type="text"
                value="Chrome"
                readOnly
                aria-readonly="true"
                className="block w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 pr-9 text-sm font-medium text-slate-700 focus:outline-none dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300"
              />
              <Lock
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="quantity-input"
                className="block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Quantity
              </label>
              <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {remainingSlots}/{limits.maxActiveInstances} slots
              </span>
            </div>
            <input
              id="quantity-input"
              name="quantity"
              type="number"
              min={1}
              max={limits.maxQuantityPerSession}
              value={quantity}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                setQuantity(Number.isNaN(parsed) ? 1 : parsed);
              }}
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            Mode
          </label>
          <div
            role="radiogroup"
            aria-label="Browser Mode"
            className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950"
          >
            {(['Normal', 'Incognito'] as const).map((option) => {
              const active = mode === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(option)}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShowScrollOptions((prev) => !prev)}
            className="flex w-full items-center justify-between text-left text-xs font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            <span>QA Scroll & Timeout Parameters</span>
            {showScrollOptions ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          {showScrollOptions && (
            <div className="mt-3 space-y-3">
              {testType === 'Website Test' && (
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={scrollEnabled}
                    onChange={(e) => setScrollEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
                  />
                  <span>Enable controlled page scrolling & lazy-load detection</span>
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="max-duration-sec"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                  >
                    Max Duration (sec)
                  </label>
                  <input
                    id="max-duration-sec"
                    type="number"
                    min={5}
                    max={180}
                    value={maxDurationSec}
                    onChange={(e) => setMaxDurationSec(Number.parseInt(e.target.value, 10) || 45)}
                    className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                {testType === 'Website Test' && scrollEnabled && (
                  <>
                    <div>
                      <label
                        htmlFor="max-scrolls"
                        className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                      >
                        Max Scrolls (1–60)
                      </label>
                      <input
                        id="max-scrolls"
                        type="number"
                        min={1}
                        max={60}
                        value={maxScrollCount}
                        onChange={(e) =>
                          setMaxScrollCount(Number.parseInt(e.target.value, 10) || 15)
                        }
                        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="scroll-interval"
                        className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                      >
                        Scroll Interval (ms)
                      </label>
                      <input
                        id="scroll-interval"
                        type="number"
                        min={250}
                        max={5000}
                        step={50}
                        value={scrollIntervalMs}
                        onChange={(e) =>
                          setScrollIntervalMs(Number.parseInt(e.target.value, 10) || 600)
                        }
                        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="scroll-distance"
                        className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                      >
                        Scroll Distance (px)
                      </label>
                      <input
                        id="scroll-distance"
                        type="number"
                        min={100}
                        max={2500}
                        step={50}
                        value={scrollDistancePx}
                        onChange={(e) =>
                          setScrollDistancePx(Number.parseInt(e.target.value, 10) || 500)
                        }
                        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>

                    <div className="col-span-2">
                      <label
                        htmlFor="stale-checks"
                        className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                      >
                        Stop after N checks with no new content (1–10)
                      </label>
                      <input
                        id="stale-checks"
                        type="number"
                        min={1}
                        max={10}
                        value={noNewContentThreshold}
                        onChange={(e) =>
                          setNoNewContentThreshold(Number.parseInt(e.target.value, 10) || 3)
                        }
                        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={authorizationConfirmed}
              onChange={(e) => {
                setAuthorizationConfirmed(e.target.checked);
                if (localError) setLocalError(null);
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
            />
            <span className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              I confirm I own or have explicit authorization to test this domain. Sessions use
              isolated temporary Chrome profiles only, never access personal cookies or passwords,
              and block ads and artificial engagement.
            </span>
          </label>
        </div>

        {activeMessage && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
              activeMessage.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
            }`}
          >
            {activeMessage.type === 'error' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{activeMessage.message}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-60 transition-colors duration-150 whitespace-nowrap shrink-0 dark:focus-visible:ring-offset-slate-900"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            <span>{submitting ? 'Launching Chrome...' : 'Generate'}</span>
          </button>

          <button
            type="button"
            disabled={!retryEligible || retrying}
            onClick={onRetrySelected}
            title={
              retryEligible && selectedSessionForRetry
                ? `Retry failed session #${selectedSessionForRetry.id}`
                : 'Select a failed or timed-out session to retry'
            }
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>
              {retrying
                ? 'Retrying...'
                : retryEligible && selectedSessionForRetry
                  ? `Retry #${selectedSessionForRetry.id}`
                  : 'Retry'}
            </span>
          </button>
        </div>
      </form>
    </section>
  );
}
