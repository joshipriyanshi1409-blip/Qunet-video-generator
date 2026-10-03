import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { cn } from '../lib/cn';

/**
 * Who is signed in, plus sign-out.
 *
 * Rendered in the sidebar (desktop) and the top bar (mobile) so the creator can
 * always see which profile their DNA belongs to.
 */
export function UserCard({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);

  if (user === null) return null;

  const label = user.displayName ?? user.email ?? user.uid;

  return (
    <div className={cn('flex items-center gap-3', compact === true && 'gap-2')}>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-peach-100 text-caption font-semibold text-peach-800"
      >
        {initials(label)}
      </span>

      {compact === true ? null : (
        <div className="min-w-0">
          <p className="truncate text-caption font-semibold text-ink-900">{label}</p>
          <p className="truncate text-tiny text-ink-500">
            {user.devBypass === true ? 'Local development' : 'Firebase account'}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          void signOut().then(() => navigate('/login'));
        }}
        className="rounded-pill px-2 py-1 text-tiny font-medium text-ink-500 transition-colors duration-150 hover:bg-peach-50 hover:text-ink-900"
      >
        Sign out
      </button>
    </div>
  );
}

function initials(label: string): string {
  const parts = label
    .split(/[\s@._-]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}
