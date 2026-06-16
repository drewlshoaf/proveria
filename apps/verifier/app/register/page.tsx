'use client';

//   /register?grant=<token>     grant-driven register (consumers). No
//                               personal tenant and no tenant
//                               memberships at all; the matching pending
//                               attestation-access grant is claimed at
//                               registration. Copy: "Verify a shared
//                               attestation".
//
// The api validates the token; this page just forwards it.

import {
  Button,
  Container,
  Eyebrow,
  Field,
  Header,
  TextInput,
} from '@proveria/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { api } from '../../lib/api';

function RegisterInner(): React.JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const grantToken = search.get('grant') ?? null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (
    e: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    if (!grantToken) {
      setError('Open the share link from your email to create a verifier account.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.register(email.trim(), password, grantToken);
      router.replace('/');
    } catch (err) {
      const status = (err as { status?: number }).status;
      const body = (err as { body?: { error?: string } }).body;
      const code = body?.error;
      const human =
        status === 409 && code === 'email_taken'
          ? 'An account with that email already exists. Sign in instead.'
          : status === 403 && code === 'grant_email_mismatch'
            ? "This share was sent to a different email address. Use that one, or ask the producer to re-share."
            : status === 400 && code === 'invalid_or_expired_grant'
              ? 'This share link is expired or no longer valid. Ask the producer for a fresh one.'
              : status === 400 && code === 'invalid_email'
                ? 'That email looks malformed.'
                : 'Registration failed. Try again.';
      setError(human);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Header />
      <Container className="py-16 sm:py-24">
        <div className="mx-auto max-w-[480px]">
          <Eyebrow>Verify a shared attestation</Eyebrow>
          <h1 className="mt-2 text-[32px] font-medium leading-[1.15] tracking-[-0.02em]">
            An attestation was shared with you
          </h1>
          <p className="mt-4 text-[16px] text-neutral-600">
            Set a password to create your verifier account. The shared
            attestation will appear on your home page after registration.
          </p>
          {!grantToken && (
            <p className="mt-6 border border-[var(--color-border)] bg-neutral-50 p-4 text-[14px] text-neutral-700">
              Open the share link from your email to create a verifier account.
            </p>
          )}

          <form onSubmit={submit} className="mt-10" noValidate>
            <Field
              htmlFor="email"
              label="Email"
              required
              hint="Must match the email the share was sent to."
            >
              <TextInput
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field
              htmlFor="password"
              label="Password"
              required
              hint="At least 8 characters."
            >
              <TextInput
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </Field>
            {error && (
              <p className="mb-4 text-[14px] text-[color:#B91C1C]">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={submitting || !grantToken}
              className="w-full"
            >
              {submitting ? 'Claiming share...' : 'Create account and verify'}
            </Button>
          </form>

          <p className="mt-6 text-[14px] text-neutral-500">
            Already have an account?{' '}
            <a
              href="/login"
              className="text-[var(--color-accent)] hover:underline"
            >
              Sign in
            </a>
            .
          </p>
        </div>
      </Container>
    </>
  );
}

// Suspense boundary required around components that call
// useSearchParams (Next.js 15 requirement for client-side searchParams).
export default function RegisterPage(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  );
}
