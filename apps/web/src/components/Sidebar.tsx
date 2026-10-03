import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useUiStore } from '../store/useUiStore';
import { UserCard } from './UserCard';
import { cn } from '../lib/cn';
import { motionTokens } from '../theme/tokens';

export interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Shown next to the label when the feature is not built yet. */
  soon?: boolean;
}

const iconClass = 'size-5 shrink-0';

const primaryNav: NavItem[] = [
  { to: '/', label: 'Home', icon: <HomeIcon /> },
  { to: '/create', label: 'Create', icon: <SparkIcon /> },
  { to: '/dna', label: 'My DNA', icon: <DnaIcon /> },
  { to: '/trends/remix', label: 'Trend Remix', icon: <TrendIcon /> },
  { to: '/hooks', label: 'Hook Lab', icon: <HookIcon /> },
  { to: '/audience', label: 'Audience', icon: <UsersIcon /> },
];

const toolsNav: NavItem[] = [
  { to: '/voice-coach', label: 'Voice Coach', icon: <MicIcon /> },
  { to: '/library', label: 'Library', icon: <LibraryIcon /> },
];

export function Sidebar() {
  const open = useUiStore((state) => state.sidebarOpen);
  const close = useUiStore((state) => state.closeSidebar);

  return (
    <>
      {/* Mobile drawer */}
      <AnimatePresence>
        {open === true ? (
          <motion.div
            className="fixed inset-0 z-40 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.fast }}
          >
            <button
              type="button"
              aria-label="Close navigation"
              onClick={close}
              className="absolute inset-0 h-full w-full cursor-default bg-ink-900/30"
            />
            <motion.nav
              aria-label="Primary"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: motionTokens.base, ease: motionTokens.ease }}
              className="relative h-full w-[280px] overflow-y-auto border-r border-line bg-surface px-4 py-6"
            >
              <SidebarContent onNavigate={close} showUser />
            </motion.nav>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Desktop rail */}
      <nav
        aria-label="Primary"
        className="sticky top-0 hidden h-dvh w-[260px] shrink-0 overflow-y-auto border-r border-line bg-surface px-4 py-6 lg:block"
      >
        <SidebarContent />
      </nav>
    </>
  );
}

function SidebarContent({ onNavigate, showUser = false }: { onNavigate?: () => void; showUser?: boolean }) {
  return (
    <div className="flex h-full flex-col gap-6">
      <NavLink to="/" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md px-2 py-1">
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-md bg-peach-500 text-white shadow-card"
        >
          <DnaIcon />
        </span>
        <span className="text-body-lg font-semibold tracking-tight text-ink-900">CreatorDNA</span>
      </NavLink>

      <ul className="space-y-1">
        {primaryNav.map((item) => (
          <li key={item.to}>
            <SidebarLink item={item} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>

      {/*
        A named region, not a bare `<div>`: the tools group is a navigation
        landmark with a visible heading, and `aria-labelledby` is what ties the
        two together for a screen reader.
      */}
      <nav aria-labelledby="sidebar-tools-heading">
        <p
          id="sidebar-tools-heading"
          className="px-3 pb-2 text-tiny font-semibold uppercase tracking-wider text-ink-300"
        >
          Tools
        </p>
        <ul className="space-y-1">
          {toolsNav.map((item) => (
            <li key={item.to}>
              <SidebarLink item={item} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto space-y-3">
        {showUser === true ? (
          <div className="rounded-lg border border-line bg-surface-muted p-3">
            <UserCard />
          </div>
        ) : null}
        <div className="rounded-lg border border-line bg-surface-muted p-3">
          <p className="text-caption font-semibold text-ink-900">CreatorDNA Studio</p>
          <p className="mt-1 text-tiny text-ink-500">
            Your voice, your audience, your videos - one persistent profile.
          </p>
        </div>
      </div>
    </div>
  );
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-body font-medium transition-colors duration-150',
          isActive === true
            ? 'bg-peach-100 text-peach-800'
            : 'text-ink-700 hover:bg-peach-50 hover:text-ink-900',
        )
      }
    >
      {item.icon}
      <span className="flex-1">{item.label}</span>
      {item.soon === true ? (
        <span className="rounded-pill bg-ink-100 px-1.5 py-0.5 text-tiny text-ink-500">soon</span>
      ) : null}
    </NavLink>
  );
}

function HomeIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function DnaIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4c0 6 10 6 10 12M17 4c0 6-10 6-10 12M7 20c0-1.2.3-2.2.8-3M17 20c0-1.2-.3-2.2-.8-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 8h7M8.5 16h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 17l5-5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 8h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S14 16 14.6 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 14.8c2 .6 3.2 2 3.6 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HookIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 9h6l-1.2 5.5a2.6 2.6 0 0 1-3.6 0z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 15v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="10" y="4" width="5" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M18.5 5.5v13M18.5 5.5l2.5 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
