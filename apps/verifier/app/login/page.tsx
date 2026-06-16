'use client';

import {
  Button,
  Container,
  Eyebrow,
  Field,
  Header,
  TextInput,
} from '@proveria/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '../../lib/api';

const EVAL_VERIFIER_EMAIL = 'verifier-eval@example.com';
const EVAL_VERIFIER_PASSWORD = 'verifier-eval-password-123';

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [nextPath, setNextPath] = useState('/');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const showEvalAutofill = process.env.NODE_ENV === 'development';

  useEffect(() => {
    setNextPath(
      safeNextPath(new URLSearchParams(window.location.search).get('next')),
    );
  }, []);

  const submit = async (
    e: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.login(email, password);
      router.replace(nextPath);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 401
          ? 'Incorrect email or password.'
          : 'Sign-in failed. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Header />
      <Container className="py-16 sm:py-24">
        <div className="mx-auto max-w-[480px]">
          <Eyebrow>Sign in</Eyebrow>
          <h1 className="mt-2 text-[32px] font-medium leading-[1.15] tracking-[-0.02em]">
            Welcome back
          </h1>
          <p className="mt-4 text-[16px] text-neutral-600">
            Sign in with the email the producer granted access to. If they sent
            a private verifier lookup, you will return to that attestation
            after sign-in.
          </p>

          <form onSubmit={submit} className="mt-10" noValidate>
            {showEvalAutofill && (
              <button
                type="button"
                onClick={() => {
                  setEmail(EVAL_VERIFIER_EMAIL);
                  setPassword(EVAL_VERIFIER_PASSWORD);
                  setError(null);
                }}
                className="mb-5 w-full border border-[var(--color-border)] px-3 py-2 text-[14px] font-medium text-neutral-700 hover:border-neutral-700"
              >
                Use local verifier account
              </button>
            )}

            <Field htmlFor="email" label="Email" required>
              <TextInput
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field htmlFor="password" label="Password" required>
              <TextInput
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {error && (
              <p className="mb-4 text-[14px] text-[color:#B91C1C]">{error}</p>
            )}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-[14px] text-neutral-500">
            Got a share link? Open it from your email, or{' '}
            <a
              href="/register"
              className="text-[var(--color-accent)] hover:underline"
            >
              create a verifier account
            </a>
            .
          </p>
        </div>
      </Container>
    </>
  );
}

const safeNextPath = (value: string | null): string => {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
};
