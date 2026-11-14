import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { TestSession } from '../types/testing.ts';
import { formatDateTime } from '../utils/format.ts';
import { StatusDisplay } from './TestHistoryPanel.tsx';

interface TestReportsPageProps {
  sessions: TestSession[];
  focusedSessionId: number | null;
  maxRetryAttempts: number;
  onSelectSession: (id: number | null) => void;
  onBackToDashboard: () => void;
  onRetrySession: (id: number) => Promise<void>;
  onClearFinishedHistory: () => Promise<void>;
}

export function TestReportsPage({
  sessions,
  focusedSessionId,
  maxRetryAttempts,
  onSelectSession,
  onBackToDashboard,
  onRetrySession,
  onClearFinishedHistory,
}: TestReportsPageProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const selectedSession =
    sessions.find((s) => s.id === focusedSessionId) ?? sessions[0] ?? null;

  const hasFinished = sessions.some(
    (s) =>
      s.status === 'completed' ||
      s.status === 'failed' ||
      s.status === 'stopped' ||
      s.status === 'timed_out'
  );

  async function handleClear() {
    setClearing(true);
    try {
      await onClearFinishedHistory();
      setConfirmClear(false);
      onSelectSession(null);
    } finally {
      setClearing(false);
    }
  }

  async function handleRetry(id: number) {
    setRetryingId(id);
    try {
      await onRetrySession(id);
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToDashboard}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Dashboard</span>
          </button>

          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Test Reports
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Complete SQLite QA reports across page load, controlled scrolling, and video checks.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={!hasFinished || clearing}
          onClick={() => setConfirmClear(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Clear History</span>
        </button>
      </div>

      {confirmClear && (
        <div
          role="alertdialog"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-3.5 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          <span className="font-medium">
            Confirm clearing all completed, failed, stopped, and timed-out reports from SQLite?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={clearing}
              onClick={handleClear}
              className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {clearing ? 'Clearing...' : 'Confirm Clear'}
            </button>
          </div>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            No test reports recorded yet
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Run an authorized Website QA Test or Video Playback Test from the dashboard to generate reports.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200">
              Sessions ({sessions.length})
            </div>
            <div className="divide-y divide-slate-200 max-h-[600px] overflow-y-auto dark:divide-slate-800">
              {sessions.map((s) => {
                const active = selectedSession?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectSession(s.id)}
                    className={`w-full px-4 py-3 text-left transition-colors duration-150 ${
                      active
                        ? 'bg-blue-50/70 dark:bg-blue-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        #{s.id}
                      </span>
                      <StatusDisplay status={s.status} />
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-slate-600 dark:text-slate-300">
                      {s.url}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {s.testType} · {s.mode} · {formatDateTime(s.createdAt)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedSession && (
            <div className="lg:col-span-8 space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-mono text-base font-bold text-slate-900 dark:text-slate-50">
                        Session #{selectedSession.id}
                      </h2>
                      <StatusDisplay status={selectedSession.status} />
                      {selectedSession.retryOfSessionId !== null && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Retry #{selectedSession.retryAttempt} of #{selectedSession.retryOfSessionId}
                        </span>
                      )}
                    </div>
                    <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">
                      {selectedSession.url}
                    </p>
                  </div>

                  {(selectedSession.status === 'failed' ||
                    selectedSession.status === 'timed_out') &&
                    selectedSession.retryAttempt < maxRetryAttempts && (
                      <button
                        type="button"
                        disabled={retryingId === selectedSession.id}
                        onClick={() => handleRetry(selectedSession.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {retryingId === selectedSession.id ? 'Retrying...' : 'Retry Failed Session'}
                        </span>
                      </button>
                    )}
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Test Type</dt>
                    <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                      {selectedSession.testType}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Browser Mode</dt>
                    <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                      Chrome · {selectedSession.mode}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Max Duration</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {Math.round(selectedSession.qaConfig.maxDurationMs / 1000)}s
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Created / Start</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatDateTime(selectedSession.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Last Updated</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatDateTime(selectedSession.updatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Quantity</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {selectedSession.quantity} instance(s)
                    </dd>
                  </div>
                </dl>

                {selectedSession.errorMessage && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                    Session Error: {selectedSession.errorMessage}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {selectedSession.results.map((inst) => (
                  <div
                    key={inst.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 text-xs dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
                      <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {inst.instanceUid}
                      </span>
                      <StatusDisplay status={inst.status} />
                    </div>

                    <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-slate-500 dark:text-slate-400">Page Title</dt>
                        <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                          {inst.pageTitle || '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500 dark:text-slate-400">Final URL</dt>
                        <dd className="mt-0.5 break-all font-mono text-slate-800 dark:text-slate-200">
                          {inst.finalUrl || selectedSession.url}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500 dark:text-slate-400">Start Time</dt>
                        <dd className="mt-0.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatDateTime(inst.startedAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500 dark:text-slate-400">End Time</dt>
                        <dd className="mt-0.5 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatDateTime(inst.completedAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500 dark:text-slate-400">Page-Load Status</dt>
                        <dd className="mt-0.5 font-mono text-slate-900 dark:text-slate-100">
                          {inst.pageLoadStatus}
                          {inst.httpStatus !== null ? ` · HTTP ${inst.httpStatus}` : ''}
                          {inst.loadTimeMs !== null ? ` · ${inst.loadTimeMs} ms` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500 dark:text-slate-400">Scroll Status</dt>
                        <dd className="mt-0.5 font-mono text-slate-900 dark:text-slate-100">
                          {inst.scrollStatus} ({inst.scrollSteps}/{inst.maxScrollSteps})
                          {inst.initialHeight !== null && inst.finalHeight !== null
                            ? ` · ${inst.initialHeight}px → ${inst.finalHeight}px`
                            : ''}
                          {inst.lazyLoadedDetected ? ' · Lazy-load detected' : ''}
                        </dd>
                      </div>

                      {selectedSession.testType === 'Video Playback Test' && (
                        <>
                          <div>
                            <dt className="text-slate-500 dark:text-slate-400">Video Player</dt>
                            <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
                              Visible:{' '}
                              {inst.videoVisible === null
                                ? '—'
                                : inst.videoVisible
                                  ? 'Yes'
                                  : 'No'}{' '}
                              · Status: {inst.videoPlaybackStatus}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500 dark:text-slate-400">Player Errors</dt>
                            <dd className="mt-0.5 text-red-700 dark:text-red-400">
                              {inst.videoError || 'None'}
                            </dd>
                          </div>
                        </>
                      )}

                      <div className="sm:col-span-2">
                        <dt className="text-slate-500 dark:text-slate-400">Report Notes / Errors</dt>
                        <dd className="mt-0.5 text-slate-700 dark:text-slate-300">
                          {inst.message || '—'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
