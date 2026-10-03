import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ToastViewport } from './Toast';
import { Button } from './Button';
import { UserCard } from './UserCard';
import { useUiStore } from '../store/useUiStore';

/** App shell: sidebar + content area, with the toast viewport mounted once. */
export function AppLayout() {
  const openSidebar = useUiStore((state) => state.openSidebar);

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-body focus:shadow-popover"
      >
        Skip to content
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <Button variant="ghost" size="sm" iconOnly onClick={openSidebar} aria-label="Open navigation">
            <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Button>
          <span className="text-body font-semibold text-ink-900">CreatorDNA Studio</span>
          <span className="ml-auto">
            <UserCard compact />
          </span>
        </div>

        <main id="main" className="min-w-0 flex-1 px-5 py-6 lg:px-10 lg:py-8">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>

      <ToastViewport />
    </div>
  );
}
