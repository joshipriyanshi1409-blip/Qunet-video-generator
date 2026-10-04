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
  { to: '/trends/remix', label: 'Trend Remix', icon: <TrendIcon /> },
  { to: '/hooks', label: 'Hook Lab', icon: <HookIcon /> },
  { to: '/audience', label: 'Audience Mirror', icon: <UsersIcon /> },
  { to: '/dna', label: 'My DNA', icon: <DnaIcon /> },
  { to: '/create', label: 'Create', icon: <IdeasIcon /> },
];

const toolsNav: NavItem[] = [
  { to: '/voice-coach', label: 'Live Voice Coach', icon: <MicIcon /> },
  { to: '/library', label: 'Library', icon: <LibraryIcon /> },
  { to: '/publish', label: 'Publish to Qoneqt', icon: <ShareIcon /> },
  { to: '/settings', label: 'Settings', icon: <ProfileIcon /> },
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
              <SidebarContent onNavigate={close} />
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

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-5">
      <NavLink to="/" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-2 py-1">
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-peach-300 via-peach-500 to-amber-500 text-white shadow-card"
        >
          <SparkBrandIcon />
        </span>
        <div className="min-w-0">
          <span className="block text-body-lg font-bold tracking-tight text-ink-900">
            CreatorDNA
          </span>
          <span className="block text-tiny font-medium text-info">Create. Create. Share.</span>
        </div>
      </NavLink>

      <ul className="space-y-1">
        {primaryNav.map((item) => (
          <li key={item.to}>
            <SidebarLink item={item} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>

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

      <div className="mt-auto space-y-3 pt-4">
        <div className="rounded-xl border border-line bg-surface-muted/80 p-3">
          <UserCard />
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
          'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-body font-medium transition-all duration-150',
          isActive === true
            ? 'border border-peach-200 bg-peach-100/90 font-semibold text-peach-800 shadow-2xs'
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

function SparkBrandIcon() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IdeasIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DnaIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4c0 6 10 6 10 12M17 4c0 6-10 6-10 12M7 20c0-1.2.3-2.2.8-3M17 20c0-1.2-.3-2.2-.8-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M8.5 8h7M8.5 16h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3c2.5 3 5 5.2 5 9a5 5 0 1 1-10 0c0-2 1-3.8 2.4-5.2.4 1.4 1.3 2.2 2.6 2.2 0-2.2.5-4.2 0-6z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S14 16 14.6 19"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 14.8c2 .6 3.2 2 3.6 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HookIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 9l5 3-5 3V9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
