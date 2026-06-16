import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';

import { rpc } from '../lib/rpc';

const DEFAULT_API_URL = 'http://127.0.0.1:3001';
const EVAL_EMAIL = 'producer-eval@example.com';
const EVAL_PASSWORD = 'producer-eval-password-123';
const SHOW_GOOGLE_SURFACES = false;

type AuthMode = 'register' | 'signIn';

interface SignInRouteProps {
  notice?: string | null;
  onSignedIn?: () => void;
}

export const SignInRoute = ({
  notice,
  onSignedIn,
}: SignInRouteProps): React.JSX.Element => {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [oidcProviders, setOidcProviders] = useState<
    Array<{ slug: string; displayName: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [oidcBusy, setOidcBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showEvalAutofill = import.meta.env.DEV && mode === 'signIn';

  useEffect(() => {
    if (mode !== 'signIn') {
      setOidcProviders([]);
      return;
    }
    let active = true;
    const loadProviders = async (): Promise<void> => {
      const result = await rpc.auth.oidcProviders({ apiUrl: apiUrl.trim() });
      if (!active) return;
      setOidcProviders(
        result.ok
          ? result.value.providers.filter(
              (provider) =>
                SHOW_GOOGLE_SURFACES || provider.slug !== 'google',
            )
          : [],
      );
    };
    void loadProviders();
    return () => {
      active = false;
    };
  }, [apiUrl, mode]);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === 'register'
        ? await rpc.auth.register({
            displayName: displayName.trim() || undefined,
            email: email.trim(),
            password,
            workspaceName: workspaceName.trim(),
            apiUrl: apiUrl.trim(),
          })
        : await rpc.auth.signIn({
            email: email.trim(),
            password,
            apiUrl: apiUrl.trim(),
          });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSignedIn?.();
    setLocation('/');
  };

  const signInWithOidc = async (provider: string): Promise<void> => {
    setOidcBusy(provider);
    setError(null);
    const result = await rpc.auth.oidcSignIn({
      apiUrl: apiUrl.trim(),
      provider,
    });
    setOidcBusy(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSignedIn?.();
    setLocation('/');
  };

  return (
    <main className="grid min-h-screen grid-cols-[minmax(420px,520px)_1fr]">
      <section className="flex items-center px-12">
        <div className="w-full max-w-[420px]">
          <p className="text-[12px] font-medium uppercase text-neutral-500">
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </p>
          <h1 className="mt-2 text-[32px] font-medium leading-tight">
            Proveria
          </h1>
          <p className="mt-4 text-[15px] leading-6 text-neutral-600">
            {mode === 'register'
              ? 'Create your account and register this desktop. The signing key is generated locally, encrypted by the operating system, and never sent to the server.'
              : 'Sign in to register this desktop. The signing key is generated locally, encrypted by the operating system, and never sent to the server.'}
          </p>

          {notice && (
            <div className="mt-5 border border-[#A16207] bg-[#FEFCE8] px-3 py-2 text-[13px] text-[#854D0E]">
              {notice}
            </div>
          )}

          <div className="mt-8 grid grid-cols-2 border border-[var(--color-border)] p-1">
            <ModeButton
              active={mode === 'signIn'}
              onClick={() => {
                setMode('signIn');
                setError(null);
              }}
            >
              Sign in
            </ModeButton>
            <ModeButton
              active={mode === 'register'}
              onClick={() => {
                setMode('register');
                setError(null);
              }}
            >
              Create account
            </ModeButton>
          </div>

          <form onSubmit={submit} className="mt-7 space-y-5">
            {mode === 'signIn' && oidcProviders.length > 0 && (
              <div className="space-y-2">
                {oidcProviders.map((provider) => (
                  <button
                    key={provider.slug}
                    type="button"
                    disabled={busy || oidcBusy !== null}
                    onClick={() => void signInWithOidc(provider.slug)}
                    className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] font-medium text-neutral-800 hover:border-neutral-700 disabled:opacity-50"
                  >
                    {oidcBusy === provider.slug
                      ? 'Waiting for browser sign-in...'
                      : `Continue with ${provider.displayName}`}
                  </button>
                ))}
                <div className="flex items-center gap-3 py-2">
                  <div className="h-px flex-1 bg-[var(--color-border)]" />
                  <span className="text-[12px] text-neutral-500">
                    or use password
                  </span>
                  <div className="h-px flex-1 bg-[var(--color-border)]" />
                </div>
              </div>
            )}

            {showEvalAutofill && (
              <button
                type="button"
                onClick={() => {
                  setEmail(EVAL_EMAIL);
                  setPassword(EVAL_PASSWORD);
                  setApiUrl(DEFAULT_API_URL);
                  setError(null);
                }}
                className="w-full border border-[var(--color-border)] px-3 py-2 text-[14px] font-medium text-neutral-700 hover:border-neutral-700"
              >
                Use local evaluation account
              </button>
            )}

            {mode === 'register' && (
              <>
                <Field label="Name" htmlFor="displayName">
                  <input
                    id="displayName"
                    type="text"
                    autoComplete="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full border border-[var(--color-border)] px-3 py-2 text-[15px] focus:border-neutral-700 focus:outline-none"
                  />
                </Field>
                <Field label="Workspace name" htmlFor="workspaceName">
                  <input
                    id="workspaceName"
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    required
                    className="w-full border border-[var(--color-border)] px-3 py-2 text-[15px] focus:border-neutral-700 focus:outline-none"
                  />
                </Field>
              </>
            )}

            <Field label="Email" htmlFor="email">
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-[var(--color-border)] px-3 py-2 text-[15px] focus:border-neutral-700 focus:outline-none"
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full border border-[var(--color-border)] px-3 py-2 text-[15px] focus:border-neutral-700 focus:outline-none"
              />
            </Field>

            <Field label="API URL" htmlFor="apiUrl">
              <input
                id="apiUrl"
                type="url"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                required
                className="w-full border border-[var(--color-border)] px-3 py-2 font-mono text-[14px] focus:border-neutral-700 focus:outline-none"
              />
            </Field>

            {error && <p className="text-[14px] text-[#B91C1C]">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-neutral-900 px-4 py-2.5 text-[15px] font-medium text-white disabled:opacity-50"
            >
              {busy
                ? mode === 'register'
                  ? 'Creating account...'
                  : 'Signing in...'
                : mode === 'register'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>
        </div>
      </section>

      <section className="border-l border-[var(--color-border)] bg-[var(--color-sidebar)] px-12 py-12">
        <div className="max-w-[560px]">
          <h2 className="text-[20px] font-medium">Local trust boundary</h2>
          <div className="mt-6 grid gap-4 text-[14px] leading-6 text-neutral-600">
            <p>File bytes stay on this machine during hashing.</p>
            <p>The server receives hashes, manifests, and signatures.</p>
            <p>Explicit sign out revokes this desktop key and clears local state.</p>
          </div>
        </div>
      </section>
    </main>
  );
};

interface FieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}

const Field = ({ label, htmlFor, children }: FieldProps): React.JSX.Element => (
  <div>
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[13px] font-medium text-neutral-700"
    >
      {label}
    </label>
    {children}
  </div>
);

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const ModeButton = ({
  active,
  onClick,
  children,
}: ModeButtonProps): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className={
      active
        ? 'bg-neutral-900 px-3 py-2 text-[14px] font-medium text-white'
        : 'px-3 py-2 text-[14px] font-medium text-neutral-600 hover:text-neutral-900'
    }
  >
    {children}
  </button>
);
