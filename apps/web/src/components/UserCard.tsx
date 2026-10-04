import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { DEVANSHI_AVATAR } from '../lib/studioFixtures';
import { cn } from '../lib/cn';

/**
 * Who is signed in, plus sign-out.
 *
 * Rendered in the sidebar (desktop) and the top bar (mobile/desktop) so the
 * creator can always see their profile and access Settings / Profile.
 */
export function UserCard({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);

  if (user === null) return null;

  const rawLabel = user.displayName ?? user.email ?? user.uid;
  const displayName =
    rawLabel === 'Local creator' || rawLabel === 'local-creator' ? 'Devanshi Goyal' : rawLabel;

  return (
    <div className={cn('flex items-center gap-3', compact === true && 'gap-2')}>
      <Link
        to="/settings"
        title="Open Settings & Profile"
        className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-pill border-2 border-peach-200 bg-peach-100 text-caption font-semibold text-peach-800 shadow-xs transition-transform hover:scale-105"
      >
        <img
          src={DEVANSHI_AVATAR}
          alt={displayName}
          className="size-full object-cover"
        />
      </Link>

      {compact === true ? null : (
        <Link to="/settings" className="min-w-0 flex-1 hover:opacity-85">
          <p className="truncate text-caption font-semibold text-ink-900">{displayName}</p>
          <p className="truncate text-tiny text-ink-500">Creator</p>
        </Link>
      )}

      <button
        type="button"
        onClick={() => {
          void signOut().then(() => navigate('/login'));
        }}
        className="rounded-pill px-2.5 py-1 text-tiny font-medium text-ink-500 transition-colors duration-150 hover:bg-peach-100 hover:text-ink-900"
      >
        Sign out
      </button>
    </div>
  );
}
