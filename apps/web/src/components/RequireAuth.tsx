import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { LoadingState } from '../components/StateViews';

/**
 * Gate for every screen that needs a creator.
 *
 * Unauthenticated visitors are sent to `/login` with the attempted path in
 * `state.from`, so sign-in returns them where they were headed.
 */
export function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-10">
        <LoadingState lines={4} />
      </div>
    );
  }

  if (status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/** Inverse gate: signed-in creators never see the login screen. */
export function RedirectIfSignedIn() {
  const status = useAuthStore((state) => state.status);

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingState lines={2} />
      </div>
    );
  }

  if (status === 'signed-in') return <Navigate to="/" replace />;
  return <Outlet />;
}
