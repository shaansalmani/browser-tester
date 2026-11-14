import { Square } from 'lucide-react';
import { useState } from 'react';
import type { TestSession } from '../types/testing.ts';

interface RunningSessionsPanelProps {
  sessions: TestSession[];
  onStopSession: (sessionId: number) => Promise<void>;
  onStopInstance: (sessionId: number, instanceIndex: number) => Promise<void>;
  onStopAll: () => Promise<void>;
}

export function RunningSessionsPanel({
  sessions,
  onStopSession,
  onStopInstance,
  onStopAll,
}: RunningSessionsPanelProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const activeSessions = sessions.filter(
    (s) => s.status === 'running' || s.status === 'pending'
  );

  async function handleStopAll() {
    setBusyKey('all');
    try {
      await onStopAll();
    } finally {
      setBusyKey(null);
    }
  }

  async function handleStopSession(sessionId: number) {
    setBusyKey(`session-${sessionId}`);
    try {
      await onStopSession(sessionId);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleStopInstance(sessionId: number, instanceIndex: number) {
    setBusyKey(`inst-${sessionId}-${instanceIndex}`);
    try {
      await onStopInstance(sessionId, instanceIndex);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section
      aria-labelledby="running-sessions-heading"
      className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div>
          <h2
            id="running-sessions-heading"
            className="text-base font-semibold text-slate-900 dark:text-slate-50"
          >
            Live Session & Scroll Progress
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Active isolated Chrome QA runs reported by the 127.0.0.1 local agent.
          </p>
        </div>

        <button
          type="button"
          disabled={activeSessions.length === 0 || busyKey !== null}
          onClick={handleStopAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150 whitespace-nowrap shrink-0 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
        >
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{busyKey === 'all' ? 'Stopping All...' : 'Stop All Sessions'}</span>
        </button>
      </div>

      {activeSessions.length === 0 ? (
        <div className="px-6 py-6 text-xs text-slate-500 dark:text-slate-400">
          No active Chrome QA sessions are running.
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {activeSessions.map((session) => {
            const activeInstances = session.results.filter(
              (r) => r.status === 'running' || r.status === 'pending'
            );

            return (
              <div key={session.id} className="px-6 py-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold tabular-nums text-blue-700 dark:text-blue-400">
                        Session #{session.id}
                      </span>
                      <span className="truncate font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                        {session.url}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {session.testType} · Chrome · {session.mode} ·{' '}
                      <span className="font-mono tabular-nums">
                        {activeInstances.length}/{session.quantity} active
                      </span>
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() => handleStopSession(session.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Square className="h-3 w-3" aria-hidden="true" />
                    <span>
                      {busyKey === `session-${session.id}` ? 'Stopping...' : 'Stop Session'}
                    </span>
                  </button>
                </div>

                {activeInstances.length > 0 && (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {activeInstances.map((inst) => (
                      <div
                        key={inst.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                              {inst.instanceUid}
                            </span>
                            <span className="text-blue-700 dark:text-blue-400 capitalize">
                              {inst.status}
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() => handleStopInstance(session.id, inst.instanceIndex)}
                            className="rounded px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50 shrink-0 dark:text-red-400 dark:hover:bg-red-950/50"
                          >
                            {busyKey === `inst-${session.id}-${inst.instanceIndex}`
                              ? 'Stopping...'
                              : 'Stop'}
                          </button>
                        </div>

                        {inst.pageTitle && (
                          <p className="mt-1 truncate text-slate-700 dark:text-slate-300">
                            {inst.pageTitle}
                          </p>
                        )}

                        {session.testType === 'Website Test' && inst.maxScrollSteps > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                              <span>
                                Scroll {inst.scrollSteps}/{inst.maxScrollSteps}
                              </span>
                              <span>{inst.scrollProgressPct}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div
                                className="h-full bg-blue-600 transition-all duration-150"
                                style={{ width: `${Math.min(100, inst.scrollProgressPct)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {inst.message && (
                          <p className="mt-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {inst.message}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
