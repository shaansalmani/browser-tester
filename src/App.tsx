import { useCallback, useEffect, useState } from 'react';
import {
  addAuthorizedDomainRequest,
  clearFinishedHistoryRequest,
  createTestSessionRequest,
  deleteTestSessionRequest,
  fetchAuthorizedDomains,
  fetchHealth,
  fetchSettings,
  fetchTestSessions,
  removeAuthorizedDomainRequest,
  retryTestSessionRequest,
  stopAllTestSessionsRequest,
  stopTestInstanceRequest,
  stopTestSessionRequest,
  updateSettingsRequest,
} from './api/client.ts';
import { DomainsAndAgentSection } from './components/DomainsAndAgentSection.tsx';
import { RunningSessionsPanel } from './components/RunningSessionsPanel.tsx';
import { StatusOverview } from './components/StatusOverview.tsx';
import { TestConfigForm } from './components/TestConfigForm.tsx';
import { TestHistoryPanel } from './components/TestHistoryPanel.tsx';
import { TestReportsPage } from './components/TestReportsPage.tsx';
import { TopBar } from './components/TopBar.tsx';
import type {
  AppSettings,
  AuthorizedDomain,
  ConcurrencyLimits,
  HealthResponse,
  QaScrollConfig,
  TestMode,
  TestSession,
  TestStatus,
  TestStatusCounts,
  TestType,
} from './types/testing.ts';

const DEFAULT_COUNTS: TestStatusCounts = {
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  stopped: 0,
  timed_out: 0,
  total: 0,
  activeInstances: 0,
};

const DEFAULT_SETTINGS: AppSettings = {
  maxQuantityPerSession: 5,
  maxActiveInstances: 5,
  allowLocalDevTargets: false,
};

const DEFAULT_LIMITS: ConcurrencyLimits = {
  allowedBrowser: 'Chrome',
  maxQuantityPerSession: 5,
  maxActiveInstances: 5,
  allowLocalDevTargets: false,
  maxRetryAttempts: 3,
};

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('browser-tester-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [activePage, setActivePage] = useState<'dashboard' | 'reports'>('dashboard');
  const [focusedReportId, setFocusedReportId] = useState<number | null>(null);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [domains, setDomains] = useState<AuthorizedDomain[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<TestSession[]>([]);
  const [counts, setCounts] = useState<TestStatusCounts>(DEFAULT_COUNTS);
  const [limits, setLimits] = useState<ConcurrencyLimits>(DEFAULT_LIMITS);

  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | TestStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem('browser-tester-theme', theme);
  }, [theme]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const data = await fetchHealth();
      setHealth(data);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadDomains = useCallback(async () => {
    const data = await fetchAuthorizedDomains();
    setDomains(data.domains);
  }, []);

  const loadSettings = useCallback(async () => {
    const data = await fetchSettings();
    setSettings(data.settings);
  }, []);

  const loadSessions = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await fetchTestSessions({
        status: statusFilter,
        q: searchQuery,
      });
      setSessions(data.sessions);
      setCounts(data.counts);
      setLimits(data.limits);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setHistoryLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    void loadHealth();
    void loadDomains();
    void loadSettings();
  }, [loadHealth, loadDomains, loadSettings]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Poll session progress every 1.5s while any Chrome QA session is running/pending
  useEffect(() => {
    if (counts.running === 0 && counts.pending === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadSessions();
      void loadHealth();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [counts.running, counts.pending, loadSessions, loadHealth]);

  async function handleGenerate(payload: {
    testType: TestType;
    url: string;
    browser: 'Chrome';
    quantity: number;
    mode: TestMode;
    authorizationConfirmed: boolean;
    qaConfig: QaScrollConfig;
  }) {
    setSubmitting(true);
    setFormFeedback(null);
    try {
      const result = await createTestSessionRequest(payload);
      setSelectedSessionId(result.session.id);
      setFormFeedback({
        type: 'success',
        message: result.message,
      });
      await Promise.all([loadSessions(), loadHealth()]);
    } catch (err) {
      setFormFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to launch Chrome QA session.',
      });
      await Promise.all([loadSessions(), loadHealth()]);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedSession =
    sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null;

  async function handleRetrySession(id: number) {
    setRetrying(true);
    setFormFeedback(null);
    try {
      const result = await retryTestSessionRequest(id);
      setSelectedSessionId(result.session.id);
      setFocusedReportId(result.session.id);
      setFormFeedback({
        type: 'success',
        message: result.message,
      });
      await Promise.all([loadSessions(), loadHealth()]);
    } catch (err) {
      setFormFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to retry session.',
      });
    } finally {
      setRetrying(false);
    }
  }

  async function handleStopSession(id: number) {
    setFormFeedback(null);
    try {
      await stopTestSessionRequest(id);
      await Promise.all([loadSessions(), loadHealth()]);
    } catch (err) {
      setFormFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to stop session.',
      });
    }
  }

  async function handleStopInstance(sessionId: number, instanceIndex: number) {
    setFormFeedback(null);
    try {
      await stopTestInstanceRequest(sessionId, instanceIndex);
      await Promise.all([loadSessions(), loadHealth()]);
    } catch (err) {
      setFormFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to stop Chrome instance.',
      });
    }
  }

  async function handleStopAll() {
    setFormFeedback(null);
    try {
      const res = await stopAllTestSessionsRequest();
      setFormFeedback({
        type: 'success',
        message: `Stopped ${res.stoppedInstances} active Chrome instance(s) and cleaned up temporary profiles.`,
      });
      await Promise.all([loadSessions(), loadHealth()]);
    } catch (err) {
      setFormFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to stop all sessions.',
      });
    }
  }

  async function handleDeleteSession(id: number) {
    setFormFeedback(null);
    try {
      await deleteTestSessionRequest(id);
      if (selectedSessionId === id) {
        setSelectedSessionId(null);
      }
      await Promise.all([loadSessions(), loadHealth()]);
    } catch (err) {
      setFormFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete session.',
      });
    }
  }

  async function handleClearFinishedHistory() {
    setFormFeedback(null);
    try {
      const res = await clearFinishedHistoryRequest();
      setFormFeedback({
        type: 'success',
        message: `Cleared ${res.deletedCount} finished test session(s) from SQLite history.`,
      });
      await loadSessions();
    } catch (err) {
      setFormFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to clear finished history.',
      });
    }
  }

  async function handleAddDomain(payload: {
    domain: string;
    ownershipNote: string;
    ownershipConfirmed: boolean;
  }) {
    await addAuthorizedDomainRequest(payload);
    await loadDomains();
  }

  async function handleQuickAuthorizeDomain(domain: string) {
    await handleAddDomain({
      domain,
      ownershipNote: 'Confirmed via test configuration',
      ownershipConfirmed: true,
    });
  }

  async function handleRemoveDomain(id: number) {
    await removeAuthorizedDomainRequest(id);
    await loadDomains();
  }

  async function handleUpdateSettings(patch: Partial<AppSettings>) {
    const res = await updateSettingsRequest(patch);
    setSettings(res.settings);
    await loadSessions();
  }

  return (
    <div
      id="top"
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      <TopBar
        theme={theme}
        activePage={activePage}
        onNavigatePage={(page) => setActivePage(page)}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
      />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {activePage === 'reports' ? (
          <TestReportsPage
            sessions={sessions}
            focusedSessionId={focusedReportId}
            maxRetryAttempts={limits.maxRetryAttempts}
            onSelectSession={(id) => setFocusedReportId(id)}
            onBackToDashboard={() => setActivePage('dashboard')}
            onRetrySession={handleRetrySession}
            onClearFinishedHistory={handleClearFinishedHistory}
          />
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">
                  Browser Tester
                </h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                  Authorized Website QA, controlled page scrolling, video playback inspection, and
                  SQLite reporting via your 127.0.0.1 Chrome agent.
                </p>
              </div>
              <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                Phase 4/4 · Production QA
              </p>
            </div>

            <StatusOverview
              counts={counts}
              activeFilter={statusFilter}
              onSelectFilter={setStatusFilter}
            />

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <TestConfigForm
                  authorizedDomains={domains}
                  counts={counts}
                  limits={limits}
                  health={health}
                  selectedSessionForRetry={selectedSession}
                  submitting={submitting}
                  retrying={retrying}
                  feedback={formFeedback}
                  onGenerate={handleGenerate}
                  onRetrySelected={async () => {
                    if (selectedSession) {
                      await handleRetrySession(selectedSession.id);
                    }
                  }}
                  onQuickAuthorizeDomain={handleQuickAuthorizeDomain}
                />
              </div>

              <div className="lg:col-span-7 space-y-6">
                <RunningSessionsPanel
                  sessions={sessions}
                  onStopSession={handleStopSession}
                  onStopInstance={handleStopInstance}
                  onStopAll={handleStopAll}
                />

                <TestHistoryPanel
                  sessions={sessions}
                  loading={historyLoading}
                  error={historyError}
                  statusFilter={statusFilter}
                  searchQuery={searchQuery}
                  selectedSessionId={selectedSession?.id ?? null}
                  maxRetryAttempts={limits.maxRetryAttempts}
                  onStatusFilterChange={setStatusFilter}
                  onSearchQueryChange={setSearchQuery}
                  onSelectSession={(session) => setSelectedSessionId(session.id)}
                  onOpenReport={(id) => {
                    setFocusedReportId(id);
                    setActivePage('reports');
                  }}
                  onRetrySession={handleRetrySession}
                  onStopSession={handleStopSession}
                  onStopInstance={handleStopInstance}
                  onDeleteSession={handleDeleteSession}
                  onClearFinishedHistory={handleClearFinishedHistory}
                  onReload={loadSessions}
                />
              </div>
            </div>

            <DomainsAndAgentSection
              domains={domains}
              health={health}
              healthLoading={healthLoading}
              settings={settings}
              onAddDomain={handleAddDomain}
              onRemoveDomain={handleRemoveDomain}
              onUpdateSettings={handleUpdateSettings}
              onRefreshHealth={loadHealth}
            />
          </>
        )}
      </main>
    </div>
  );
}
