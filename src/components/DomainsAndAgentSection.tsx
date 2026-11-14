import { AlertCircle, CheckCircle2, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AppSettings, AuthorizedDomain, HealthResponse } from '../types/testing.ts';

interface DomainsAndAgentSectionProps {
  domains: AuthorizedDomain[];
  health: HealthResponse | null;
  healthLoading: boolean;
  settings: AppSettings;
  onAddDomain: (payload: {
    domain: string;
    ownershipNote: string;
    ownershipConfirmed: boolean;
  }) => Promise<void>;
  onRemoveDomain: (id: number) => Promise<void>;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onRefreshHealth: () => Promise<void>;
}

export function DomainsAndAgentSection({
  domains,
  health,
  healthLoading,
  settings,
  onAddDomain,
  onRemoveDomain,
  onUpdateSettings,
  onRefreshHealth,
}: DomainsAndAgentSectionProps) {
  const [domainInput, setDomainInput] = useState('');
  const [ownershipNote, setOwnershipNote] = useState('');
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);

  const [maxActive, setMaxActive] = useState(settings.maxActiveInstances);
  const [maxPerSession, setMaxPerSession] = useState(settings.maxQuantityPerSession);
  const [allowLocalDev, setAllowLocalDev] = useState(settings.allowLocalDevTargets);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    setMaxActive(settings.maxActiveInstances);
    setMaxPerSession(settings.maxQuantityPerSession);
    setAllowLocalDev(settings.allowLocalDevTargets);
  }, [settings]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDomainError(null);

    if (!domainInput.trim()) {
      setDomainError('Enter a domain or hostname you own or are authorized to test.');
      return;
    }

    if (!ownershipConfirmed) {
      setDomainError('Confirm ownership or written authorization before adding this domain.');
      return;
    }

    setSubmitting(true);
    try {
      await onAddDomain({
        domain: domainInput.trim(),
        ownershipNote: ownershipNote.trim() || 'Authorized domain',
        ownershipConfirmed: true,
      });
      setDomainInput('');
      setOwnershipNote('');
      setOwnershipConfirmed(false);
    } catch (err) {
      setDomainError(err instanceof Error ? err.message : 'Unable to authorize domain.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsMsg(null);

    if (!Number.isInteger(maxActive) || maxActive < 1 || maxActive > 10) {
      setSettingsMsg({
        type: 'error',
        text: 'Max concurrent instances must be between 1 and 10.',
      });
      return;
    }

    if (!Number.isInteger(maxPerSession) || maxPerSession < 1 || maxPerSession > 5) {
      setSettingsMsg({
        type: 'error',
        text: 'Max per session must be between 1 and 5.',
      });
      return;
    }

    if (maxPerSession > maxActive) {
      setSettingsMsg({
        type: 'error',
        text: 'Max per session cannot exceed max concurrent instances.',
      });
      return;
    }

    setSavingSettings(true);
    try {
      await onUpdateSettings({
        maxActiveInstances: maxActive,
        maxQuantityPerSession: maxPerSession,
        allowLocalDevTargets: allowLocalDev,
      });
      setSettingsMsg({
        type: 'success',
        text: 'Concurrency and local target settings saved.',
      });
    } catch (err) {
      setSettingsMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  }

  const agent = health?.agentInterface;

  return (
    <section
      id="domains"
      aria-labelledby="domains-heading"
      className="grid grid-cols-1 gap-6 lg:grid-cols-12"
    >
      <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <h2
            id="domains-heading"
            className="text-base font-semibold text-slate-900 dark:text-slate-50"
          >
            Authorized Domains
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Tests are restricted strictly to domains you own or are authorized to test.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="domain-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Domain or Hostname
              </label>
              <input
                id="domain-input"
                type="text"
                value={domainInput}
                onChange={(e) => {
                  setDomainInput(e.target.value);
                  if (domainError) setDomainError(null);
                }}
                placeholder="staging.example.com"
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <div>
              <label
                htmlFor="ownership-note"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Authorization Note
              </label>
              <input
                id="ownership-note"
                type="text"
                value={ownershipNote}
                onChange={(e) => setOwnershipNote(e.target.value)}
                placeholder="Company QA environment"
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer dark:text-slate-300">
              <input
                type="checkbox"
                checked={ownershipConfirmed}
                onChange={(e) => {
                  setOwnershipConfirmed(e.target.checked);
                  if (domainError) setDomainError(null);
                }}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
              />
              <span>I own or hold authorization for this domain</span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60 transition-colors duration-150 whitespace-nowrap shrink-0 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{submitting ? 'Adding...' : 'Authorize Domain'}</span>
            </button>
          </div>

          {domainError && (
            <p className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{domainError}</span>
            </p>
          )}
        </form>

        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
          {domains.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No authorized domains registered yet. Add a domain above to enable test generation.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {domains.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-4 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {entry.domain}
                    </span>
                    <span className="mx-2 text-slate-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">{entry.ownershipNote}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveDomain(entry.id)}
                    aria-label={`Remove ${entry.domain}`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="lg:col-span-5 space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Local Chrome Agent
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Authenticated 127.0.0.1 Playwright companion.
              </p>
            </div>

            <button
              type="button"
              onClick={onRefreshHealth}
              disabled={healthLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{healthLoading ? 'Checking...' : 'Check'}</span>
            </button>
          </div>

          <dl className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2.5 dark:border-slate-800/70">
              <dt className="text-slate-500 dark:text-slate-400">Bind Address</dt>
              <dd className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                {agent ? `${agent.bindHost}:${agent.port}` : '127.0.0.1:47120'}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2.5 dark:border-slate-800/70">
              <dt className="text-slate-500 dark:text-slate-400">Agent Connection</dt>
              <dd>
                {agent?.reachable && agent.authenticated ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Connected & Authenticated</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{agent?.reachable ? 'Auth Error' : 'Offline (run npm run agent)'}</span>
                  </span>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2.5 dark:border-slate-800/70">
              <dt className="text-slate-500 dark:text-slate-400">Google Chrome</dt>
              <dd className="text-right">
                {agent?.chrome.installed ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Installed</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{agent?.reachable ? 'Not Detected' : 'Unknown (Agent Offline)'}</span>
                  </span>
                )}
              </dd>
            </div>

            {agent?.chrome.executablePath && (
              <div className="border-b border-slate-100 pb-2.5 dark:border-slate-800/70">
                <dt className="text-slate-500 dark:text-slate-400">Chrome Executable</dt>
                <dd className="mt-1 truncate font-mono text-slate-700 dark:text-slate-300">
                  {agent.chrome.executablePath}
                </dd>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2.5 dark:border-slate-800/70">
              <dt className="text-slate-500 dark:text-slate-400">Active Windows</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {agent?.activeInstancesCount ?? 0} running
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">SQLite Database</dt>
              <dd className="font-mono text-slate-900 dark:text-slate-100">
                {health?.database.connected
                  ? `Connected (${health.database.tables.length} tables)`
                  : 'Unavailable'}
              </dd>
            </div>
          </dl>
        </div>

        <form
          onSubmit={handleSaveSettings}
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Concurrency & Security Settings
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="max-concurrent-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Max Concurrent (1–10)
              </label>
              <input
                id="max-concurrent-input"
                type="number"
                min={1}
                max={10}
                value={maxActive}
                onChange={(e) => setMaxActive(Number.parseInt(e.target.value, 10) || 1)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="max-per-session-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Max Per Session (1–5)
              </label>
              <input
                id="max-per-session-input"
                type="number"
                min={1}
                max={5}
                value={maxPerSession}
                onChange={(e) => setMaxPerSession(Number.parseInt(e.target.value, 10) || 1)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer dark:text-slate-300">
            <input
              type="checkbox"
              checked={allowLocalDev}
              onChange={(e) => setAllowLocalDev(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 dark:border-slate-600 dark:bg-slate-900"
            />
            <span>
              Allow localhost / 127.0.0.1 targets for local development (private LAN & cloud metadata IPs remain blocked)
            </span>
          </label>

          <div className="flex items-center justify-between gap-3">
            <span
              className={`text-xs ${
                settingsMsg?.type === 'error'
                  ? 'text-red-700 dark:text-red-400'
                  : settingsMsg?.type === 'success'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {settingsMsg?.text ?? ''}
            </span>
            <button
              type="submit"
              disabled={savingSettings}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
