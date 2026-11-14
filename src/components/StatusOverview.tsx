import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PlayCircle,
  Square,
  XCircle,
} from 'lucide-react';
import type { TestStatus, TestStatusCounts } from '../types/testing.ts';

interface StatusOverviewProps {
  counts: TestStatusCounts;
  activeFilter: 'all' | TestStatus;
  onSelectFilter: (filter: 'all' | TestStatus) => void;
}

export function StatusOverview({
  counts,
  activeFilter,
  onSelectFilter,
}: StatusOverviewProps) {
  const items: Array<{
    key: TestStatus;
    label: string;
    value: number;
    icon: typeof Clock;
    accentClass: string;
    description: string;
  }> = [
    {
      key: 'pending',
      label: 'Pending',
      value: counts.pending,
      icon: Clock,
      accentClass: 'text-amber-700 dark:text-amber-400',
      description: 'Queued',
    },
    {
      key: 'running',
      label: 'Running',
      value: counts.running,
      icon: PlayCircle,
      accentClass: 'text-blue-700 dark:text-blue-400',
      description: 'Active Chrome',
    },
    {
      key: 'completed',
      label: 'Completed',
      value: counts.completed,
      icon: CheckCircle2,
      accentClass: 'text-emerald-700 dark:text-emerald-400',
      description: 'QA passed',
    },
    {
      key: 'failed',
      label: 'Failed',
      value: counts.failed,
      icon: XCircle,
      accentClass: 'text-red-700 dark:text-red-400',
      description: 'Load/player error',
    },
    {
      key: 'stopped',
      label: 'Stopped',
      value: counts.stopped,
      icon: Square,
      accentClass: 'text-slate-700 dark:text-slate-300',
      description: 'Halted by user',
    },
    {
      key: 'timed_out',
      label: 'Timed Out',
      value: counts.timed_out,
      icon: AlertTriangle,
      accentClass: 'text-orange-700 dark:text-orange-400',
      description: 'Hit time limit',
    },
  ];

  return (
    <section id="status" aria-labelledby="status-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-4">
        <h2
          id="status-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Test Status
        </h2>
        <p className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {counts.total} total sessions
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {items.map((item) => {
          const Icon = item.icon;
          const isSelected = activeFilter === item.key;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelectFilter(isSelected ? 'all' : item.key)}
              aria-pressed={isSelected}
              className={`flex flex-col items-start justify-between gap-2.5 p-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                isSelected
                  ? 'bg-slate-50 dark:bg-slate-800/70'
                  : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${item.accentClass}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {isSelected && (
                  <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    Active
                  </span>
                )}
              </div>

              <div>
                <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-slate-50">
                  {item.value}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {item.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
