import { Moon, Sun } from 'lucide-react';

interface TopBarProps {
  theme: 'light' | 'dark';
  activePage: 'dashboard' | 'reports';
  onNavigatePage: (page: 'dashboard' | 'reports') => void;
  onToggleTheme: () => void;
}

export function TopBar({
  theme,
  activePage,
  onNavigatePage,
  onToggleTheme,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => onNavigatePage('dashboard')}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded dark:text-slate-50"
        >
          Browser Tester
        </button>

        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <button
            type="button"
            onClick={() => onNavigatePage('dashboard')}
            className={`transition-colors duration-150 whitespace-nowrap shrink-0 underline-offset-4 hover:text-slate-900 dark:hover:text-white ${
              activePage === 'dashboard'
                ? 'text-blue-700 underline dark:text-blue-400'
                : 'hover:underline'
            }`}
          >
            Dashboard
          </button>

          <button
            type="button"
            onClick={() => onNavigatePage('reports')}
            className={`transition-colors duration-150 whitespace-nowrap shrink-0 underline-offset-4 hover:text-slate-900 dark:hover:text-white ${
              activePage === 'reports'
                ? 'text-blue-700 underline dark:text-blue-400'
                : 'hover:underline'
            }`}
          >
            Test Reports
          </button>

          {activePage === 'dashboard' && (
            <>
              <a
                href="#history"
                className="hidden sm:inline hover:text-slate-900 hover:underline underline-offset-4 transition-colors duration-150 whitespace-nowrap shrink-0 dark:hover:text-white"
              >
                History
              </a>
              <a
                href="#domains"
                className="hidden sm:inline hover:text-slate-900 hover:underline underline-offset-4 transition-colors duration-150 whitespace-nowrap shrink-0 dark:hover:text-white"
              >
                Domains
              </a>
            </>
          )}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 transition-colors duration-150 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Dark</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
