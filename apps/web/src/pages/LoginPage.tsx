import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useAuthStore, DEV_USER_UID } from '../store/useAuthStore';
import { Button } from '../components/Button';
import { Card, CardContent } from '../components/Card';
import { motionTokens } from '../theme/tokens';

type Mode = 'signin' | 'signup';

/**
 * Login / signup.
 *
 * With a Firebase project configured this offers Google and email/password.
 * Without one (local development) it offers the dev bypass that maps to the
 * API's `x-dev-uid` header, so the whole onboarding flow stays testable.
 */
export function LoginPage() {
  const firebaseReady = useAuthStore((state) => state.firebaseReady);
  const pending = useAuthStore((state) => state.pending);
  const error = useAuthStore((state) => state.error);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signInWithEmail = useAuthStore((state) => state.signInWithEmail);
  const signUpWithEmail = useAuthStore((state) => state.signUpWithEmail);
  const signInAsDevUser = useAuthStore((state) => state.signInAsDevUser);
  const clearError = useAuthStore((state) => state.clearError);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function switchMode(next: Mode) {
    setMode(next);
    clearError();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'signin') await signInWithEmail(email, password);
    else await signUpWithEmail(email, password);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: motionTokens.base, ease: motionTokens.ease }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex size-12 items-center justify-center rounded-md bg-peach-500 text-white shadow-card"
          >
            <svg className="size-6" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 4c0 6 10 6 10 12M17 4c0 6-10 6-10 12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <h1 className="mt-4 text-display font-semibold tracking-tight text-ink-900">
            CreatorDNA Studio
          </h1>
          <p className="mt-2 text-body text-ink-500">
            One persistent profile that makes every video sound like you.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="mb-6 flex rounded-pill bg-surface-muted p-1"
            >
              {(['signin', 'signup'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => switchMode(value)}
                  className={[
                    'flex-1 rounded-pill px-4 py-2 text-caption font-medium transition-colors duration-150',
                    mode === value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500',
                  ].join(' ')}
                >
                  {value === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            {error === null ? null : (
              <p
                role="alert"
                className="mb-4 rounded-md border border-danger-soft bg-danger-soft/40 px-3 py-2 text-caption text-danger-strong"
              >
                {error}
              </p>
            )}

            {firebaseReady === true ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="mb-5 w-full"
                  loading={pending}
                  onClick={() => void signInWithGoogle()}
                >
                  <GoogleIcon />
                  Continue with Google
                </Button>

                <div className="mb-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-tiny uppercase tracking-wider text-ink-300">or</span>
                  <span className="h-px flex-1 bg-line" />
                </div>

                <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
                  <Field
                    id="email"
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={setEmail}
                    required
                  />
                  <Field
                    id="password"
                    label="Password"
                    type="password"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={setPassword}
                    required
                    hint={mode === 'signup' ? 'At least 6 characters.' : undefined}
                  />

                  <Button type="submit" className="w-full" loading={pending}>
                    {mode === 'signin' ? 'Sign in' : 'Create account'}
                  </Button>
                </form>
              </>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
                  <p className="text-caption font-semibold text-ink-900">Firebase is not configured</p>
                  <p className="mt-1 text-tiny text-ink-500">
                    Set the <code>VITE_FIREBASE_*</code> variables in <code>apps/web/.env</code> to
                    enable Google and email sign-in. Until then you can continue with a local
                    development profile.
                  </p>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  loading={pending}
                  onClick={() => void signInAsDevUser(DEV_USER_UID)}
                >
                  Continue as local creator
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-tiny text-ink-300">
          Your Creator DNA stays yours: it is stored per account and only ever injected into your
          own prompts.
        </p>
      </motion.div>
    </main>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}

function Field({ id, label, type, value, onChange, autoComplete, required, hint }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-caption font-medium text-ink-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-ink-900 outline-none transition-colors duration-150 placeholder:text-ink-300 focus:border-peach-300 focus:ring-2 focus:ring-peach-100"
      />
      {hint === undefined ? null : (
        <p className="mt-1 text-tiny text-ink-500">{hint}</p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A11.9 11.9 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a11.9 11.9 0 0 0 0 10.7z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 11.9 11.9 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
      />
    </svg>
  );
}
