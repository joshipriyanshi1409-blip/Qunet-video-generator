import { Link, Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ToastViewport } from './Toast';
import { Button } from './Button';
import { UserCard } from './UserCard';
import { DEVANSHI_AVATAR } from '../lib/studioFixtures';
import { useUiStore } from '../store/useUiStore';
import { useToast } from '../hooks/useToast';

/** App shell: sidebar + content area, with the toast viewport mounted once. */
export function AppLayout() {
  const openSidebar = useUiStore((state) => state.openSidebar);
  const { push } = useToast();

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
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

        {/* Desktop top studio utility bar (Notification bell + Creator Avatar) */}
        <div className="hidden items-center justify-end gap-3 px-10 pt-5 lg:flex">
          <button
            type="button"
            aria-label="Notifications"
            onClick={() =>
              push({
                title: 'Creator DNA synced (87%)',
                description: 'Your Binary Search reel is ready to share on Qoneqt.',
                tone: 'success',
              })
            }
            className="relative flex size-10 items-center justify-center rounded-pill border border-line bg-surface text-ink-700 shadow-2xs transition-colors hover:bg-peach-50 hover:text-ink-900"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-pill bg-danger text-[10px] font-bold text-white">
              1
            </span>
          </button>

          <Link
            to="/settings"
            title="Devanshi Goyal · Settings & Profile"
            className="flex items-center gap-2.5 rounded-pill border border-line bg-surface py-1 pl-1 pr-3 shadow-2xs transition-colors hover:bg-peach-50"
          >
            <img
              src={DEVANSHI_AVATAR}
              alt="Devanshi Goyal"
              className="size-8 rounded-pill object-cover"
            />
            <span className="text-caption font-semibold text-ink-900">Devanshi</span>
          </Link>
        </div>

        <main id="main" className="min-w-0 flex-1 px-5 py-6 lg:px-10 lg:pb-10 lg:pt-3">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>

      <ToastViewport />
    </div>
  );
}
