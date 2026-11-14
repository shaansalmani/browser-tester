import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  PlayCircle,
  RotateCcw,
  Search,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { TestSession, TestStatus } from '../types/testing.ts';
import { formatDateTime } from '../utils/format.ts';

interface TestHistoryPanelProps {
  sessions: TestSession[];
  loading: boolean;
  error: string | null;
  statusFilter: 'all' | TestStatus;
  searchQuery: string;
  selectedSessionId: number | null;
  maxRetryAttempts: number;
  onStatusFilterChange: (filter: 'all' | TestStatus) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectSession: (session: TestSession) => void;
  onOpenReport: (sessionId: number) => void;
  onRetrySession: (id: number) => Promise<void>;
  onStopSession: (id: number) => Promise<void>;
  onStopInstance: (sessionId: number, instanceIndex: number) => Promise<void>;
  onDeleteSession: (id: number) => Promise<void>;
  onClearFinishedHistory: () => Promise<void>;
  onReload: () => Promise<void>;
}

export function StatusDisplay({ status }: { status: TestStatus }) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Pending</span>
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
          <PlayCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Running</span>
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Completed</span>
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Failed</span>
        </span>
      );
    case 'stopped':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          <Square className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Stopped</span>
        </span>
      );
    case 'timed_out':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-700 dark:text-orange-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Timed Out</span>
        </span>
      );
  }
}

export function TestHistoryPanel({
  sessions,
  loading,
  error,
  statusFilter,
  searchQuery,
  selectedSessionId,
  maxRetryAttempts,
  onStatusFilterChange,
  onSearchQueryChange,
  onSelectSession,
  onOpenReport,
  onRetrySession,
  onStopSession,
  onStopInstance,
  onDeleteSession,
  onClearFinishedHistory,
  onReload,
}: TestHistoryPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const filterTabs: Array<{ id: 'all' | TestStatus; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'running', label: 'Running' },
    { id: 'completed', label: 'Completed' },
    { id: 'failed', label: 'Failed' },
    { id: 'stopped', label: 'Stopped' },
    { id: 'timed_out', label: 'Timed Out' },
  ];

  const hasFinishedSessions = sessions.some(
    (s) =>
      s.status === 'completed' ||
      s.status === 'failed' ||
      s.status === 'stopped' ||
      s.status === 'timed_out'
  );

  async function handleRetry(id: number) {
    setBusyId(id);
    try {
      await onRetrySession(id);
    } finally {
      setBusyId(null);
    }
  }

  async function handleStop(id: number) {
    setBusyId(id);
    try {
      await onStopSession(id);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      await onDeleteSession(id);
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmClear() {
    setClearing(true);
    try {
      await onClearFinishedHistory();
      setConfirmClearOpen(false);
    } finally {
      setClearing(false);
    }
  }

  return (
    <section
      id="history"
      aria-labelledby="history-heading"
      className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-4 border-b border-slate-200 p-6 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="history-heading"
              className="text-base font-semibold text-slate-900 dark:text-slate-50"
            >
              Test History
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Persisted Chrome QA sessions, scroll results, and timestamps.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="Filter by URL or domain..."
                aria-label="Filter test history"
                className="block w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <button
              type="button"
              disabled={!hasFinishedSessions || clearing}
              onClick={() => setConfirmClearOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear History</span>
            </button>
          </div>
        </div>

        {confirmClearOpen && (
          <div
            role="alertdialog"
            aria-labelledby="clear-history-confirm-title"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          >
            <span id="clear-history-confirm-title" className="font-medium">
              Delete all completed, failed, stopped, and timed-out sessions from SQLite? Active sessions will remain.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={clearing}
                onClick={handleConfirmClear}
                className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {clearing ? 'Clearing...' : 'Confirm Clear'}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950">
          {filterTabs.map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onStatusFilterChange(tab.id)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1">
        {loading && sessions.length === 0 ? (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {[1, 2, 3].map((row) => (
              <div key={row} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="space-y-2">
                  <div className="h-4 w-56 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3 w-40 rounded bg-slate-100 dark:bg-slate-800/60" />
                </div>
                <div className="h-4 w-20 rounded bg-slate-200 dark:bg-slate-800" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Unable to load test history
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{error}</p>
            </div>
            <button
              type="button"
              onClick={onReload}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              Try Again
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No test sessions found
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Ensure the local Chrome agent is running on your PC, authorize a domain you own, and
              click Generate to launch isolated Chrome QA sessions.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {sessions.map((session) => {
              const isExpanded = expandedId === session.id;
              const isSelected = selectedSessionId === session.id;
              const isBusy = busyId === session.id;
              const isActive = session.status === 'running' || session.status === 'pending';
              const canRetry =
                (session.status === 'failed' || session.status === 'timed_out') &&
                session.retryAttempt < maxRetryAttempts;

              return (
                <div
                  key={session.id}
                  className={`transition-colors duration-150 ${
                    isSelected
                      ? 'bg-blue-50/50 dark:bg-blue-950/20'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/30'
                  }`}
                >
                  <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div
                      onClick={() => onSelectSession(session)}
                      className="min-w-0 flex-1 cursor-pointer space-y-1"
                    >
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="font-mono text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                          #{session.id}
                        </span>
                        <span className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                          {session.url}
                        </span>
                        {session.retryOfSessionId !== null && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            · Retry #{session.retryAttempt} of #{session.retryOfSessionId}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>{session.testType}</span>
                        <span aria-hidden="true">·</span>
                        <span>{session.browser}</span>
                        <span aria-hidden="true">·</span>
                        <span>{session.mode}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {session.quantity} {session.quantity === 1 ? 'instance' : 'instances'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <time
                          dateTime={session.createdAt}
                          title={session.createdAt}
                          className="font-mono tabular-nums"
                        >
                          {formatDateTime(session.createdAt)}
                        </time>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 sm:justify-end shrink-0">
                      <StatusDisplay status={session.status} />

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : session.id)}
                          aria-expanded={isExpanded}
                          aria-label={`Toggle instance details for session #${session.id}`}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span>Details</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onOpenReport(session.id)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Report</span>
                        </button>

                        {isActive ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleStop(session.id)}
                            aria-label={`Stop session #${session.id}`}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                          >
                            <Square className="h-3 w-3" aria-hidden="true" />
                            <span>Stop</span>
                          </button>
                        ) : (
                          canRetry && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRetry(session.id)}
                              aria-label={`Retry failed session #${session.id}`}
                              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Retry</span>
                            </button>
                          )
                        )}

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDelete(session.id)}
                          aria-label={`Delete session #${session.id}`}
                          className="inline-flex items-center rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-200 bg-slate-50 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                      {session.errorMessage && (
                        <p className="mb-3 text-xs text-red-700 dark:text-red-400">
                          Error: {session.errorMessage}
                        </p>
                      )}

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                              <th className="py-1.5 pr-4 font-medium">Session ID</th>
                              <th className="py-1.5 pr-4 font-medium">Result</th>
                              <th className="py-1.5 pr-4 font-medium">Page Title</th>
                              <th className="py-1.5 pr-4 font-medium">Load</th>
                              <th className="py-1.5 pr-4 font-medium">Scroll / Video</th>
                              <th className="py-1.5 text-right font-medium">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                            {session.results.map((result) => (
                              <tr key={result.id} className="text-slate-700 dark:text-slate-300">
                                <td className="py-2 pr-4 font-mono tabular-nums">
                                  {result.instanceUid}
                                </td>
                                <td className="py-2 pr-4">
                                  <StatusDisplay status={result.status} />
                                </td>
                                <td className="max-w-[180px] truncate py-2 pr-4">
                                  {result.pageTitle || '—'}
                                </td>
                                <td className="py-2 pr-4 font-mono tabular-nums">
                                  {result.httpStatus ?? '—'}
                                  {result.loadTimeMs !== null ? ` · ${result.loadTimeMs}ms` : ''}
                                </td>
                                <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                                  {session.testType === 'Website Test'
                                    ? `${result.scrollStatus} (${result.scrollSteps}/${result.maxScrollSteps})`
                                    : `${result.videoPlaybackStatus}`}
                                </td>
                                <td className="py-2 text-right">
                                  {(result.status === 'running' || result.status === 'pending') && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onStopInstance(session.id, result.instanceIndex)
                                      }
                                      className="font-medium text-red-700 hover:underline dark:text-red-400"
                                    >
                                      Stop
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
